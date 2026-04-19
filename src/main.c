/* 
 * Next Menu Core - Main Entry Point
 * 
 * This is a native PS5 ELF daemon that hosts a web server
 * to manage payloads and system settings.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <microhttpd.h>

#include "next_menu.h"
#include "assets_index_html.h"
#include "payload_mgr.h"
#include "ps5_launcher.h"

#define DEFAULT_PORT MENU_PORT

static volatile int keep_running = 1;

/* Global buffer for JSON responses */
static char response_buffer[65536];

/* State for file uploads */
struct UploadStatus {
    FILE *fp;
    size_t total_size;
    int error;
};

/* Callback for handling HTTP requests */
static enum MHD_Result on_request(void *cls, struct MHD_Connection *conn,
                                const char *url, const char *method,
                                const char *version, const char *upload_data,
                                size_t *upload_data_size, void **con_cls) {
    
    /* Handle CORS Preflight (OPTIONS) */
    if (strcmp(method, "OPTIONS") == 0) {
        struct MHD_Response *resp = MHD_create_response_from_buffer(0, NULL, MHD_RESPMEM_PERSISTENT);
        MHD_add_response_header(resp, "Access-Control-Allow-Origin", "*");
        MHD_add_response_header(resp, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        MHD_add_response_header(resp, "Access-Control-Allow-Headers", "Content-Type");
        enum MHD_Result ret = MHD_queue_response(conn, MHD_HTTP_OK, resp);
        MHD_destroy_response(resp);
        return ret;
    }

    /* Initial call for a new request */
    if (*con_cls == NULL) {
        if (strncmp(url, ROUTE_UPLOAD, strlen(ROUTE_UPLOAD)) == 0) {
            struct UploadStatus *status = malloc(sizeof(struct UploadStatus));
            status->fp = NULL;
            status->total_size = 0;
            status->error = 0;

            const char *filename = MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "filename");
            if (filename) {
                char path[512];
                snprintf(path, sizeof(path), "%s/%s", BASE_DATA_DIR, filename);
                
                mkdir(BASE_DATA_DIR, 0777);
                
                status->fp = fopen(path, "wb");
                if (!status->fp) {
                    printf("[NextMenu] !!! FAILED to open file: %s\n", path);
                    status->error = 1;
                } else {
                    printf("[NextMenu] Starting upload to: %s\n", path);
                }
            } else {
                printf("[NextMenu] !!! Upload failed: Missing filename parameter\n");
                status->error = 1;
            }
            *con_cls = status;
            return MHD_YES;
        }
        
        *con_cls = (void*)1;
        return MHD_YES;
    }

    /* Chunked data arrival */
    if (strncmp(url, ROUTE_UPLOAD, strlen(ROUTE_UPLOAD)) == 0) {
        struct UploadStatus *status = (struct UploadStatus *)*con_cls;
        if (*upload_data_size != 0) {
            if (status->fp && !status->error) {
                size_t written = fwrite(upload_data, 1, *upload_data_size, status->fp);
                if (written != *upload_data_size) {
                    printf("[NextMenu] !!! Write error: expected %zu, got %zu\n", *upload_data_size, written);
                    status->error = 1;
                }
                status->total_size += written;
            }
            *upload_data_size = 0;
            return MHD_YES;
        } else {
            /* Upload finished */
            if (status->fp) {
                fflush(status->fp);
                fclose(status->fp);
            }
            printf("[NextMenu] Upload finished. Total bytes: %zu, Error: %d\n", status->total_size, status->error);
            
            int err = status->error;
            free(status);
            *con_cls = NULL;

            const char *msg = err ? "Error during upload\n" : MSG_OK;
            struct MHD_Response *resp = MHD_create_response_from_buffer(strlen(msg), (void *)msg, MHD_RESPMEM_MUST_COPY);
            MHD_add_response_header(resp, "Access-Control-Allow-Origin", "*");
            enum MHD_Result ret = MHD_queue_response(conn, err ? MHD_HTTP_INTERNAL_SERVER_ERROR : MHD_HTTP_OK, resp);
            MHD_destroy_response(resp);
            return ret;
        }
    }

    printf("[NextMenu] Request: %s %s\n", method, url);

    struct MHD_Response *resp = NULL;
    enum MHD_Result ret;

    /* Route: Index or index.html */
    if (strcmp(url, ROUTE_INDEX) == 0 || strcmp(url, ROUTE_INDEX_HTML) == 0) {
        resp = MHD_create_response_from_buffer(assets_index_html_len, 
                                             (void *)assets_index_html, 
                                             MHD_RESPMEM_PERSISTENT);
        MHD_add_response_header(resp, "Content-Type", "text/html");
    } else if (strcmp(url, ROUTE_LIST_PAYLOADS) == 0) {
        size_t len = payload_mgr_list_json(response_buffer, sizeof(response_buffer));
        resp = MHD_create_response_from_buffer(len, (void *)response_buffer, MHD_RESPMEM_MUST_COPY);
        MHD_add_response_header(resp, "Content-Type", "application/json");
    } else if (strncmp(url, ROUTE_LOAD_PAYLOAD, strlen(ROUTE_LOAD_PAYLOAD)) == 0) {
        const char *path = url + strlen(ROUTE_LOAD_PAYLOAD);
        if (ps5_launch_elf(path) == 0) {
            resp = MHD_create_response_from_buffer(strlen(MSG_OK), (void *)MSG_OK, MHD_RESPMEM_PERSISTENT);
        } else {
            const char *err = "Failed to launch payload\n";
            resp = MHD_create_response_from_buffer(strlen(err), (void *)err, MHD_RESPMEM_PERSISTENT);
        }
        MHD_add_response_header(resp, "Content-Type", "text/plain");
    } else if (strncmp(url, ROUTE_DELETE, strlen(ROUTE_DELETE)) == 0) {
        const char *filename = MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "filename");
        if (filename) {
            char path[512];
            /* Basic safety: skip if filename contains / or .. */
            if (strstr(filename, "/") || strstr(filename, "..")) {
                const char *err = "Invalid filename\n";
                resp = MHD_create_response_from_buffer(strlen(err), (void *)err, MHD_RESPMEM_PERSISTENT);
            } else {
                snprintf(path, sizeof(path), "%s/%s", BASE_DATA_DIR, filename);
                if (remove(path) == 0) {
                    printf("[NextMenu] Deleted payload: %s\n", path);
                    resp = MHD_create_response_from_buffer(strlen(MSG_OK), (void *)MSG_OK, MHD_RESPMEM_PERSISTENT);
                } else {
                    const char *err = "Failed to delete file\n";
                    resp = MHD_create_response_from_buffer(strlen(err), (void *)err, MHD_RESPMEM_PERSISTENT);
                }
            }
        } else {
            const char *err = "Missing filename\n";
            resp = MHD_create_response_from_buffer(strlen(err), (void *)err, MHD_RESPMEM_PERSISTENT);
        }
        MHD_add_response_header(resp, "Content-Type", "text/plain");
    } else if (strcmp(url, ROUTE_SHUTDOWN) == 0) {
        const char *msg = "Next Menu Core shutting down...\n";
        resp = MHD_create_response_from_buffer(strlen(msg), (void *)msg, MHD_RESPMEM_PERSISTENT);
        MHD_add_response_header(resp, "Content-Type", "text/plain");
        keep_running = 0; /* Signal main loop to exit */
    } else {
        /* Default: 404 for now */
        const char *not_found = "404 Not Found\n";
        resp = MHD_create_response_from_buffer(strlen(not_found), (void *)not_found, MHD_RESPMEM_PERSISTENT);
        MHD_add_response_header(resp, "Content-Type", "text/plain");
    }

    if (!resp) return MHD_NO;

    /* Add CORS headers */
    MHD_add_response_header(resp, "Access-Control-Allow-Origin", "*");
    
    ret = MHD_queue_response(conn, MHD_HTTP_OK, resp);
    MHD_destroy_response(resp);

    return ret;
}

int main(int argc, char *argv[]) {
    struct MHD_Daemon *daemon;
    unsigned short port = DEFAULT_PORT;

    printf("[NextMenu] Starting Native Core on port %d...\n", port);

    /* Ignore SIGPIPE to prevent crashes on socket disconnects */
    signal(SIGPIPE, SIG_IGN);

    /* Start the MHD daemon */
    daemon = MHD_start_daemon(MHD_USE_SELECT_INTERNALLY | MHD_USE_DEBUG,
                             port, NULL, NULL, &on_request, NULL,
                             MHD_OPTION_END);

    if (NULL == daemon) {
        printf("[NextMenu] Failed to start HTTP daemon!\n");
        return 1;
    }

    printf("[NextMenu] Server is running. Visit /shutdown to exit.\n");

    /* Keep the daemon running until keep_running is 0 */
    while (keep_running) {
        usleep(100000); /* 100ms sleep */
    }

    printf("[NextMenu] Shutting down...\n");
    MHD_stop_daemon(daemon);
    
    /* Give some time for sockets to close before process exits */
    sleep(1);
    
    return 0;
}
