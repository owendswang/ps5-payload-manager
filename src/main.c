/*
 * Payload Manager Core - Main Entry Point
 *
 * This is a native PS5 ELF daemon that hosts a web server
 * to manage payloads and system settings.
 */

#include <arpa/inet.h>
#include <microhttpd.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/sysctl.h>
#include <sys/stat.h>
#include <unistd.h>

#include "assets_index_html.h"
#include "assets_cache_appcache.h"
#include "assets_favicon_svg.h"
#include "assets_icon_png.h"

#include "pldmgr.h"


#include "payload_mgr.h"
#include "ps5_launcher.h"
#include "app_installer.h"
#include <errno.h>
#include <pthread.h>
#include <stdarg.h>

#define MAX_LOG_LINES 100
#define MAX_LOG_LINE_LEN 256
#define RESPONSE_BUFFER_SIZE 65536
#define CORS_ORIGIN "*"

static char log_buffer[MAX_LOG_LINES][MAX_LOG_LINE_LEN];
static int log_head = 0;
static int log_count = 0;
static pthread_mutex_t log_mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t log_cond = PTHREAD_COND_INITIALIZER;
static int log_updated = 0;

static volatile sig_atomic_t resume_flag = 0;

void handle_sigcont(int sig) { resume_flag = 1; }

static pid_t
find_pid(const char* name) {
  int mib[4] = {1, 14, 8, 0};
  pid_t mypid = getpid();
  pid_t pid = -1;
  size_t buf_size;
  uint8_t *buf;

  if(sysctl(mib, 4, 0, &buf_size, 0, 0)) {
    pldmgr_log("[PLDMGR] sysctl failed\n");
    return -1;
  }

  if(!(buf=malloc(buf_size))) {
    pldmgr_log("[PLDMGR] malloc failed\n");
    return -1;
  }

  if(sysctl(mib, 4, buf, &buf_size, 0, 0)) {
    pldmgr_log("[PLDMGR] sysctl failed\n");
    free(buf);
    return -1;
  }

  for(uint8_t *ptr=buf; ptr<(buf+buf_size);) {
    int ki_structsize = *(int*)ptr;
    pid_t ki_pid = *(pid_t*)&ptr[72];
    char *ki_tdname = (char*)&ptr[447];

    ptr += ki_structsize;
    if(!strcmp(name, ki_tdname) && ki_pid != mypid) {
      pid = ki_pid;
    }
  }

  free(buf);

  return pid;
}

void pldmgr_log(const char *fmt, ...) {
  char line[MAX_LOG_LINE_LEN];
  va_list args;
  va_start(args, fmt);
  vsnprintf(line, sizeof(line), fmt, args);
  va_end(args);

  /* Print to stdout */
  printf("%s", line);

  /* Remove trailing newline for internal storage if present */
  size_t len = strlen(line);
  while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) {
    line[len - 1] = '\0';
    len--;
  }

  if (len == 0)
    return;

  /* Add to circular buffer with lock */
  pthread_mutex_lock(&log_mutex);
  strncpy(log_buffer[log_head], line, MAX_LOG_LINE_LEN);
  log_head = (log_head + 1) % MAX_LOG_LINES;
  if (log_count < MAX_LOG_LINES)
    log_count++;

  /* Signal SSE clients */
  log_updated++;
  pthread_cond_broadcast(&log_cond);
  pthread_mutex_unlock(&log_mutex);
}
/* SSE Log Callback */
struct LogSSEConnection {
  int last_log_version;
  int sent_initial;
};

static ssize_t log_stream_callback(void *cls, uint64_t pos, char *buf,
                                   size_t max) {
  struct LogSSEConnection *conn = (struct LogSSEConnection *)cls;

  pthread_mutex_lock(&log_mutex);

  /* Initial catch-up */
  if (!conn->sent_initial) {
    char initial_batch[MAX_LOG_LINES * (MAX_LOG_LINE_LEN + 16)];
    size_t offset = 0;

    for (int i = 0; i < log_count; i++) {
      int idx = (log_head - log_count + i + MAX_LOG_LINES) % MAX_LOG_LINES;
      offset += snprintf(initial_batch + offset, sizeof(initial_batch) - offset,
                         "data: %s\n\n", log_buffer[idx]);
    }

    conn->sent_initial = 1;
    conn->last_log_version = log_updated;

    if (offset > 0) {
      size_t to_copy = (offset < max) ? offset : max;
      memcpy(buf, initial_batch, to_copy);
      pthread_mutex_unlock(&log_mutex);
      return to_copy;
    }
  }

  /* Wait for new logs */
  while (conn->last_log_version == log_updated) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    ts.tv_sec += 5; /* Keep-alive ping interval */

    if (pthread_cond_timedwait(&log_cond, &log_mutex, &ts) == ETIMEDOUT) {
      /* Send a comment keep-alive */
      const char *ping = ": ping\n\n";
      memcpy(buf, ping, strlen(ping));
      pthread_mutex_unlock(&log_mutex);
      return strlen(ping);
    }
  }

  /* Send new log */
  int idx = (log_head - 1 + MAX_LOG_LINES) % MAX_LOG_LINES;
  size_t len = snprintf(buf, max, "data: %s\n\n", log_buffer[idx]);
  conn->last_log_version = log_updated;

  pthread_mutex_unlock(&log_mutex);
  return len;
}

static void log_stream_cleanup(void *cls) { free(cls); }
#define DEFAULT_PORT MENU_PORT

static volatile int server_active_flag = 0;

int pldmgr_server_is_active() { return server_active_flag; }

static volatile int keep_running = 1;

static void add_cors_headers(struct MHD_Response *resp) {
  MHD_add_response_header(resp, "Access-Control-Allow-Origin", CORS_ORIGIN);
}

/*
 * Allocate a per-request response buffer.
 * On success: sets *out to the buffer and returns NULL.
 * On failure: returns a ready-to-queue 500 JSON error response (caller must
 *             queue and destroy it, then early-return).
 */
static struct MHD_Response *alloc_response_buffer(char **out) {
  *out = malloc(RESPONSE_BUFFER_SIZE);
  if (*out)
    return NULL;
  static const char oom[] = "{\"error\":\"Out of memory\"}";
  struct MHD_Response *resp = MHD_create_response_from_buffer(
      sizeof(oom) - 1, (void *)oom, MHD_RESPMEM_PERSISTENT);
  MHD_add_response_header(resp, "Content-Type", "application/json");
  add_cors_headers(resp);
  return resp;
}

static int has_supported_extension(const char *path) {
  const char *ext = strrchr(path, '.');
  if (!ext)
    return 0;
  return strcasecmp(ext, ".elf") == 0 || strcasecmp(ext, ".bin") == 0;
}

static int is_safe_filename(const char *name) {
  if (!name || name[0] == '\0')
    return 0;
  if (strstr(name, "/") || strstr(name, ".."))
    return 0;
  return 1;
}

static int is_allowed_payload_path(const char *path) {
  if (!path || path[0] == '\0')
    return 0;
  if (strstr(path, ".."))
    return 0;
  if (!has_supported_extension(path))
    return 0;

  for (int i = 0; i < SCAN_DIRS_COUNT; i++) {
    size_t len = strlen(SCAN_DIRS[i]);
    if (strncmp(path, SCAN_DIRS[i], len) == 0 &&
        (path[len] == '/' || path[len] == '\0')) {
      return 1;
    }
  }

  /* Allow USB root payloads if SCAN_USB_PAYLOADS is enabled in config */
  if (strncmp(path, "/mnt/usb", 8) == 0 &&
      path[8] >= '0' && path[8] <= '7' &&
      path[9] == '/') {
    if (pldmgr_read_config_bool("SCAN_USB_PAYLOADS", 0)) {
      return 1;
    }
  }

  return 0;
}

/* State for POST requests */
struct PostStatus {
  char *data;
  size_t size;
  int error;
};

/* State for file uploads */
struct UploadStatus {
  FILE *fp;
  size_t total_size;
  int error;
  char filename[256];
  char temp_path[512];
  char repo_url[512];
};

static void read_next_config_values(int *enabled, long *repo_update,
                                    int *browser_open, int *auto_delay,
                                    int *kill_disc_player, int *scan_usb, int *auto_install_app,
                                    int *multi_sources) {
  FILE *f = fopen(PLDMGR_CONFIG_PATH, "r");
  char line[256];

  *enabled = 0;
  *repo_update = 0;
  *browser_open = 1;     /* Default on */
  *auto_delay = 5;       /* Default 5s */
  *kill_disc_player = 1; /* Default on */
  *scan_usb = 0;         /* Default off */
  *auto_install_app = 1; /* Default on */
  *multi_sources = 0;    /* Default off */

  if (!f) {
    return;
  }

  while (fgets(line, sizeof(line), f)) {
    if (strncmp(line, "AUTOLOAD_ENABLED=", 17) == 0) {
      *enabled = atoi(line + 17);
    } else if (strncmp(line, "LAST_REPOSITORY_UPDATE=", 23) == 0) {
      *repo_update = atol(line + 23);
    } else if (strncmp(line, "AUTO_BROWSER_OPEN=", 18) == 0) {
      *browser_open = atoi(line + 18);
    } else if (strncmp(line, "AUTOLOAD_DELAY=", 15) == 0) {
      *auto_delay = atoi(line + 15);
    } else if (strncmp(line, "KILL_DISC_PLAYER_ON_STARTUP=", 28) == 0) {
      *kill_disc_player = atoi(line + 28);
    } else if (strncmp(line, "SCAN_USB_PAYLOADS=", 18) == 0) {
      *scan_usb = atoi(line + 18);
    } else if (strncmp(line, "AUTO_INSTALL_APP=", 17) == 0) {
      *auto_install_app = atoi(line + 17);
    } else if (strncmp(line, "MULTI_SOURCES_ENABLED=", 22) == 0) {
      *multi_sources = atoi(line + 22);
    }
  }
  fclose(f);
}

static int write_next_config_values(int enabled, long repo_update,
                                    int browser_open, int auto_delay,
                                    int kill_disc_player, int scan_usb, int auto_install_app,
                                    int multi_sources) {
  FILE *f;

  mkdir(BASE_DATA_DIR, 0777);
  f = fopen(PLDMGR_CONFIG_PATH, "w");
  if (!f) {
    return -1;
  }

  fprintf(f, "AUTOLOAD_ENABLED=%d\n", enabled ? 1 : 0);
  fprintf(f, "LAST_REPOSITORY_UPDATE=%ld\n", repo_update);
  fprintf(f, "AUTO_BROWSER_OPEN=%d\n", browser_open ? 1 : 0);
  fprintf(f, "AUTOLOAD_DELAY=%d\n", auto_delay);
  fprintf(f, "KILL_DISC_PLAYER_ON_STARTUP=%d\n", kill_disc_player ? 1 : 0);
  fprintf(f, "SCAN_USB_PAYLOADS=%d\n", scan_usb ? 1 : 0);
  fprintf(f, "AUTO_INSTALL_APP=%d\n", auto_install_app ? 1 : 0);
  fprintf(f, "MULTI_SOURCES_ENABLED=%d\n", multi_sources ? 1 : 0);
  fclose(f);
  return 0;
}

/* Callback for handling HTTP requests */
static enum MHD_Result on_request(void *cls, struct MHD_Connection *conn,
                                  const char *url, const char *method,
                                  const char *version, const char *upload_data,
                                  size_t *upload_data_size, void **con_cls) {

  /* Handle CORS Preflight (OPTIONS) */
  if (strcmp(method, "OPTIONS") == 0) {
    struct MHD_Response *resp =
        MHD_create_response_from_buffer(0, NULL, MHD_RESPMEM_PERSISTENT);
    add_cors_headers(resp);
    MHD_add_response_header(resp, "Access-Control-Allow-Methods",
                            "GET, POST, OPTIONS");
    MHD_add_response_header(resp, "Access-Control-Allow-Headers",
                            "Content-Type");
    enum MHD_Result ret = MHD_queue_response(conn, MHD_HTTP_OK, resp);
    MHD_destroy_response(resp);
    return ret;
  }

  /* Set flag that we received a request (meaning browser is open) */
  server_active_flag = 1;

  /* Initial call for a new request */
  if (*con_cls == NULL) {
    if (strncmp(url, ROUTE_UPLOAD, strlen(ROUTE_UPLOAD)) == 0) {
      struct UploadStatus *status = malloc(sizeof(struct UploadStatus));
      status->fp = NULL;
      status->total_size = 0;
      status->error = 0;

      const char *filename =
          MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "filename");
      if (filename && !strstr(filename, "/") && !strstr(filename, "..")) {
        char path[512];
        mkdir(BASE_DATA_DIR, 0777);
        mkdir(PAYLOADS_STORAGE_DIR, 0777);
        snprintf(path, sizeof(path), "%s/%s.tmp", PAYLOADS_STORAGE_DIR, filename);

        strncpy(status->filename, filename, sizeof(status->filename) - 1);
        status->filename[sizeof(status->filename) - 1] = '\0';
        strncpy(status->temp_path, path, sizeof(status->temp_path) - 1);
        status->temp_path[sizeof(status->temp_path) - 1] = '\0';

        status->fp = fopen(path, "wb");
        if (!status->fp) {
          pldmgr_log("[PLDMGR] !!! FAILED to open temp file: %s\n", path);
          status->error = 1;
        } else {
          pldmgr_log("[PLDMGR] Starting upload to temp: %s\n", path);
        }
      } else {
        pldmgr_log("[PLDMGR] !!! Upload failed: Missing filename parameter\n");
        status->error = 1;
      }
      *con_cls = status;
      return MHD_YES;
    }

    if (strcmp(url, ROUTE_SET_CONFIG) == 0 && strcmp(method, "POST") == 0) {
      struct PostStatus *status = malloc(sizeof(struct PostStatus));
      status->data = NULL;
      status->size = 0;
      status->error = 0;
      *con_cls = status;
      return MHD_YES;
    }

    if (strcmp(url, ROUTE_REPO_PUSH) == 0 && strcmp(method, "POST") == 0) {
      struct PostStatus *status = malloc(sizeof(struct PostStatus));
      status->data = NULL;
      status->size = 0;
      status->error = 0;
      *con_cls = status;
      return MHD_YES;
    }

    if (strcmp(url, ROUTE_SOURCES_SET) == 0 && strcmp(method, "POST") == 0) {
      struct PostStatus *status = malloc(sizeof(struct PostStatus));
      status->data = NULL;
      status->size = 0;
      status->error = 0;
      *con_cls = status;
      return MHD_YES;
    }

    if (strncmp(url, ROUTE_REPO_INSTALL_PUSH,
                strlen(ROUTE_REPO_INSTALL_PUSH)) == 0 &&
        strcmp(method, "POST") == 0) {
      struct UploadStatus *status = malloc(sizeof(struct UploadStatus));
      status->fp = NULL;
      status->total_size = 0;
      status->error = 0;
      const char *filename =
          MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "filename");
      if (filename && !strstr(filename, "/") && !strstr(filename, "..")) {
        char path[512];
        mkdir(BASE_DATA_DIR, 0777);
        mkdir(PAYLOADS_STORAGE_DIR, 0777);
        snprintf(path, sizeof(path), "%s/%s.part", PAYLOADS_STORAGE_DIR,
                 filename);
        strncpy(status->filename, filename, sizeof(status->filename) - 1);
        status->filename[sizeof(status->filename) - 1] = '\0';
        strncpy(status->temp_path, path, sizeof(status->temp_path) - 1);
        status->temp_path[sizeof(status->temp_path) - 1] = '\0';

        const char *repo_url = MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "repo_url");
        if (repo_url) {
            strncpy(status->repo_url, repo_url, sizeof(status->repo_url) - 1);
            status->repo_url[sizeof(status->repo_url) - 1] = '\0';
        } else {
            strncpy(status->repo_url, REPOSITORY_SOURCE_URL, sizeof(status->repo_url) - 1);
            status->repo_url[sizeof(status->repo_url) - 1] = '\0';
        }

        status->fp = fopen(path, "wb");
        if (!status->fp) {
          pldmgr_log("[PLDMGR] !!! Failed to open for install: %s\n", path);
          status->error = 1;
        } else {
          pldmgr_log("[PLDMGR] Installing payload: %s\n", path);
        }
      } else {
        pldmgr_log("[PLDMGR] !!! install_push: invalid filename\n");
        status->error = 1;
      }
      *con_cls = status;
      return MHD_YES;
    }

    *con_cls = (void *)1;
    return MHD_YES;
  }

  /* Handle POST data for set_config */
  if (strcmp(url, ROUTE_SET_CONFIG) == 0 && strcmp(method, "POST") == 0) {
    struct PostStatus *status = (struct PostStatus *)*con_cls;
    if (*upload_data_size != 0) {
      char *new_data =
          realloc(status->data, status->size + *upload_data_size + 1);
      if (!new_data) {
        status->error = 1;
      } else {
        status->data = new_data;
        memcpy(status->data + status->size, upload_data, *upload_data_size);
        status->size += *upload_data_size;
        status->data[status->size] = '\0';
      }
      *upload_data_size = 0;
      return MHD_YES;
    } else {
      /* Finished receiving JSON */
      pldmgr_log("[PLDMGR] Received config update: %s\n",
             status->data ? status->data : "(null)");

      /* Very basic JSON extraction for "AUTOLOAD_LIST":"..." and
       * "AUTOLOAD_ENABLED":true/false */
      if (status->data && !status->error) {
        int enabled = -1;
        char *enabled_pos = strstr(status->data, "\"AUTOLOAD_ENABLED\"");
        if (enabled_pos) {
          char *val = strchr(enabled_pos, ':');
          if (val) {
            val++;
            while (*val == ' ')
              val++;
            if (strncmp(val, "true", 4) == 0)
              enabled = 1;
            else if (strncmp(val, "false", 5) == 0)
              enabled = 0;
          }
        }

        if (enabled != -1) {
          int ex_en, ex_br, ex_del, ex_kill, ex_usb, ex_install, ex_multi;
          long ex_repo;
          read_next_config_values(&ex_en, &ex_repo, &ex_br, &ex_del, &ex_kill, &ex_usb, &ex_install, &ex_multi);

          /* Update individual fields from JSON if present */
          int browser_open = ex_br;
          char *browser_pos = strstr(status->data, "\"AUTO_BROWSER_OPEN\"");
          if (browser_pos) {
            char *val = strchr(browser_pos, ':');
            if (val) {
              val++;
              while (*val == ' ')
                val++;
              if (strncmp(val, "true", 4) == 0)
                browser_open = 1;
              else if (strncmp(val, "false", 5) == 0)
                browser_open = 0;
            }
          }

          int auto_delay = ex_del;
          char *delay_pos = strstr(status->data, "\"AUTOLOAD_DELAY\"");
          if (delay_pos) {
            char *val = strchr(delay_pos, ':');
            if (val) {
              val++;
              while (*val == ' ')
                val++;
              auto_delay = atoi(val);
            }
          }

          int kill_disc = ex_kill;
          char *kill_pos =
              strstr(status->data, "\"KILL_DISC_PLAYER_ON_STARTUP\"");
          if (kill_pos) {
            char *val = strchr(kill_pos, ':');
            if (val) {
              val++;
              while (*val == ' ')
                val++;
              if (strncmp(val, "true", 4) == 0)
                kill_disc = 1;
              else if (strncmp(val, "false", 5) == 0)
                kill_disc = 0;
            }
          }

          int scan_usb = ex_usb;
          char *usb_pos = strstr(status->data, "\"SCAN_USB_PAYLOADS\"");
          if (usb_pos) {
            char *val = strchr(usb_pos, ':');
            if (val) {
              val++;
              while (*val == ' ')
                val++;
              if (strncmp(val, "true", 4) == 0)
                scan_usb = 1;
              else if (strncmp(val, "false", 5) == 0)
                scan_usb = 0;
            }
          }

          int auto_install = ex_install;
          char *install_pos = strstr(status->data, "\"AUTO_INSTALL_APP\"");
          if (install_pos) {
            char *val = strchr(install_pos, ':');
            if (val) {
              val++;
              while (*val == ' ')
                val++;
              if (strncmp(val, "true", 4) == 0)
                auto_install = 1;
              else if (strncmp(val, "false", 5) == 0)
                auto_install = 0;
            }
          }

          int multi_sources = ex_multi;
          char *multi_pos = strstr(status->data, "\"MULTI_SOURCES_ENABLED\"");
          if (multi_pos) {
            char *val = strchr(multi_pos, ':');
            if (val) {
              val++;
              while (*val == ' ')
                val++;
              if (strncmp(val, "true", 4) == 0)
                multi_sources = 1;
              else if (strncmp(val, "false", 5) == 0)
                multi_sources = 0;
            }
          }

          if (write_next_config_values(enabled, ex_repo, browser_open,
                                       auto_delay, kill_disc, scan_usb, auto_install, multi_sources) == 0) {
            pldmgr_log("[PLDMGR] Saved config to %s\n", PLDMGR_CONFIG_PATH);
          }
          if (enabled == 0)
            pldmgr_autoload_abort();
        }

        char *list_start = strstr(status->data, "\"AUTOLOAD_LIST\"");
        if (list_start) {
          char *val = strchr(list_start, ':');
          if (val) {
            val++;
            while (*val == ' ' || *val == '\"')
              val++;

            /* Find the end of the string value */
            char *list_end = strchr(val, '\"');
            size_t list_len = list_end ? (size_t)(list_end - val) : 0;
            char *list_val = malloc(list_len + 1);
            if (list_val) {
              memcpy(list_val, val, list_len);
              list_val[list_len] = '\0';

              mkdir(BASE_DATA_DIR, 0777);
              FILE *f = fopen(AUTOLOAD_CONFIG_PATH, "w");
              if (f) {
                char *token = strtok(list_val, ",");
                while (token) {
                  fprintf(f, "%s\n", token);
                  token = strtok(NULL, ",");
                }
                fclose(f);
                pldmgr_log("[PLDMGR] Saved autoload list to %s\n",
                       AUTOLOAD_CONFIG_PATH);
              }
              free(list_val);
            }
          }
        }
      }

      if (status->data)
        free(status->data);
      free(status);
      *con_cls = NULL;

      struct MHD_Response *resp = MHD_create_response_from_buffer(
          strlen(MSG_OK), (void *)MSG_OK, MHD_RESPMEM_MUST_COPY);
      add_cors_headers(resp);
      enum MHD_Result ret = MHD_queue_response(conn, MHD_HTTP_OK, resp);
      MHD_destroy_response(resp);
      return ret;
    }
  }

  /* Handle POST data for /repository_push (browser fetched JSON) */
  if (strcmp(url, ROUTE_REPO_PUSH) == 0 && strcmp(method, "POST") == 0) {
    struct PostStatus *status = (struct PostStatus *)*con_cls;
    if (*upload_data_size != 0) {
      char *nd = realloc(status->data, status->size + *upload_data_size + 1);
      if (!nd) {
        status->error = 1;
      } else {
        status->data = nd;
        memcpy(status->data + status->size, upload_data, *upload_data_size);
        status->size += *upload_data_size;
        status->data[status->size] = '\0';
      }
      *upload_data_size = 0;
      return MHD_YES;
    } else {
      int ok = -1;
      if (status->data && !status->error)
        ok = payload_mgr_repository_push_json(status->data, status->size);
      if (status->data)
        free(status->data);
      free(status);
      *con_cls = NULL;

      /* Return the current list JSON so the frontend refreshes in one trip */
      char *resp_buf;
      struct MHD_Response *oom_resp = alloc_response_buffer(&resp_buf);
      if (oom_resp) {
        enum MHD_Result ret2 = MHD_queue_response(conn, MHD_HTTP_INTERNAL_SERVER_ERROR, oom_resp);
        MHD_destroy_response(oom_resp);
        return ret2;
      }

      size_t len = payload_mgr_repository_list_json(resp_buf,
                                                    RESPONSE_BUFFER_SIZE, 0);
      struct MHD_Response *resp = MHD_create_response_from_buffer(
          len, (void *)resp_buf, MHD_RESPMEM_MUST_FREE);
      MHD_add_response_header(resp, "Content-Type", "application/json");
      add_cors_headers(resp);
      enum MHD_Result ret2 = MHD_queue_response(
          conn, ok == 0 ? MHD_HTTP_OK : MHD_HTTP_BAD_REQUEST, resp);
      MHD_destroy_response(resp);
      return ret2;
    }
  }

  /* Handle POST data for /sources_set */
  if (strcmp(url, ROUTE_SOURCES_SET) == 0 && strcmp(method, "POST") == 0) {
    struct PostStatus *status = (struct PostStatus *)*con_cls;
    if (*upload_data_size != 0) {
      char *nd = realloc(status->data, status->size + *upload_data_size + 1);
      if (!nd) {
        status->error = 1;
      } else {
        status->data = nd;
        memcpy(status->data + status->size, upload_data, *upload_data_size);
        status->size += *upload_data_size;
        status->data[status->size] = '\0';
      }
      *upload_data_size = 0;
      return MHD_YES;
    } else {
      int ok = -1;
      if (status->data && !status->error)
        ok = payload_mgr_sources_save(status->data, status->size);
      if (status->data)
        free(status->data);
      free(status);
      *con_cls = NULL;

      const char *msg = ok == 0 ? MSG_OK : "Failed to save sources";
      struct MHD_Response *resp_ss = MHD_create_response_from_buffer(
          strlen(msg), (void *)msg, MHD_RESPMEM_MUST_COPY);
      add_cors_headers(resp_ss);
      enum MHD_Result ret_ss = MHD_queue_response(
          conn, ok == 0 ? MHD_HTTP_OK : MHD_HTTP_INTERNAL_SERVER_ERROR, resp_ss);
      MHD_destroy_response(resp_ss);
      return ret_ss;
    }
  }

  /* Chunked data arrival */
  if (strncmp(url, ROUTE_UPLOAD, strlen(ROUTE_UPLOAD)) == 0) {
    struct UploadStatus *status = (struct UploadStatus *)*con_cls;
    if (*upload_data_size != 0) {
      if (status->fp && !status->error) {
        size_t written = fwrite(upload_data, 1, *upload_data_size, status->fp);
        if (written != *upload_data_size) {
          pldmgr_log("[PLDMGR] !!! Write error: expected %zu, got %zu\n",
                 *upload_data_size, written);
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
        status->fp = NULL;

        if (!status->error) {
           char msg[256];
           if (payload_mgr_import_to_storage(status->filename, status->temp_path, "web_upload", "", msg, sizeof(msg)) != 0) {
              pldmgr_log("[PLDMGR] !!! Failed to commit upload: %s\n", msg);
              status->error = 1;
           }
        }
      }
      pldmgr_log("[PLDMGR] Upload finished. Total bytes: %zu, Error: %d\n",
             status->total_size, status->error);

      int err = status->error;
      free(status);
      *con_cls = NULL;

      const char *msg = err ? "Error during upload\n" : MSG_OK;
      struct MHD_Response *resp = MHD_create_response_from_buffer(
          strlen(msg), (void *)msg, MHD_RESPMEM_MUST_COPY);
      add_cors_headers(resp);
      enum MHD_Result ret = MHD_queue_response(
          conn, err ? MHD_HTTP_INTERNAL_SERVER_ERROR : MHD_HTTP_OK, resp);
      MHD_destroy_response(resp);
      return ret;
    }
  }

  /* Chunked data arrival for /repository_install_push */
  if (strncmp(url, ROUTE_REPO_INSTALL_PUSH, strlen(ROUTE_REPO_INSTALL_PUSH)) ==
      0) {
    struct UploadStatus *status = (struct UploadStatus *)*con_cls;
    if (*upload_data_size != 0) {
      if (status->fp && !status->error) {
        size_t written = fwrite(upload_data, 1, *upload_data_size, status->fp);
        if (written != *upload_data_size) {
          status->error = 1;
        }
        status->total_size += written;
      }
      *upload_data_size = 0;
      return MHD_YES;
    } else {
      if (status->fp) {
        fflush(status->fp);
        fclose(status->fp);
      }
      int err = status->error;

      char msg_buf[1024] = "";
      if (!err) {
        /* Commit the install: verify SHA256 and move to final destination */
        if (payload_mgr_repository_install_commit(
                status->filename, status->temp_path, "repository", status->repo_url, msg_buf,
                sizeof(msg_buf)) != 0) {
          err = 1;
        }
      }

      pldmgr_log("[PLDMGR] Payload install %s (%zu bytes)\n",
             err ? "FAILED" : "complete", status->total_size);
      free(status);
      *con_cls = NULL;
      if (err && msg_buf[0] == '\0') {
        snprintf(msg_buf, sizeof(msg_buf), "Write error");
      }
      char json_resp[1024];
      snprintf(json_resp, sizeof(json_resp), "{\"ok\":%s,\"message\":\"%s\"}",
               err ? "false" : "true", err ? msg_buf : "Installed");
      struct MHD_Response *resp2 = MHD_create_response_from_buffer(
          strlen(json_resp), (void *)json_resp, MHD_RESPMEM_MUST_COPY);
      MHD_add_response_header(resp2, "Content-Type", "application/json");
      add_cors_headers(resp2);
      enum MHD_Result ret2 = MHD_queue_response(
          conn, err ? MHD_HTTP_INTERNAL_SERVER_ERROR : MHD_HTTP_OK, resp2);
      MHD_destroy_response(resp2);
      return ret2;
    }
  }

  /* Only log significant requests, not pollers like /log or static assets */
  if (strcmp(url, ROUTE_LOG) != 0 && strcmp(url, ROUTE_INDEX) != 0 &&
      strcmp(url, ROUTE_INDEX_HTML) != 0 && strcmp(url, "/favicon.svg") != 0 &&
      strcmp(url, "/icon.png") != 0) {
    pldmgr_log("[PLDMGR] Request: %s %s\n", method, url);
  }

  struct MHD_Response *resp = NULL;
  enum MHD_Result ret;
  int http_status = MHD_HTTP_OK;

  if (strcmp(url, ROUTE_USB_MOVE_CHECK) == 0) {
    const char *path = MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "path");
    if (path) {
      char *resp_buf;
      struct MHD_Response *oom_resp = alloc_response_buffer(&resp_buf);
      if (oom_resp) {
        ret = MHD_queue_response(conn, MHD_HTTP_INTERNAL_SERVER_ERROR, oom_resp);
        MHD_destroy_response(oom_resp);
        return ret;
      }
      int rc = payload_mgr_usb_check(path, resp_buf, RESPONSE_BUFFER_SIZE);
      resp = MHD_create_response_from_buffer(strlen(resp_buf), (void *)resp_buf, MHD_RESPMEM_MUST_FREE);
      MHD_add_response_header(resp, "Content-Type", "application/json");
      add_cors_headers(resp);
      ret = MHD_queue_response(conn, rc == 0 ? MHD_HTTP_OK : MHD_HTTP_BAD_REQUEST, resp);
      MHD_destroy_response(resp);
      return ret;
    } else {
      const char *err = "{\"error\":\"Missing path\"}";
      resp = MHD_create_response_from_buffer(strlen(err), (void *)err, MHD_RESPMEM_MUST_COPY);
      MHD_add_response_header(resp, "Content-Type", "application/json");
    }
    add_cors_headers(resp);
    ret = MHD_queue_response(conn, MHD_HTTP_BAD_REQUEST, resp);
    MHD_destroy_response(resp);
    return ret;
  }

  if (strcmp(url, ROUTE_USB_MOVE_PERFORM) == 0) {
    const char *path = MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "path");
    const char *overwrite_str = MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "overwrite");
    int overwrite = (overwrite_str && strcmp(overwrite_str, "true") == 0) ? 1 : 0;
    if (path) {
      char *resp_buf;
      struct MHD_Response *oom_resp = alloc_response_buffer(&resp_buf);
      if (oom_resp) {
        ret = MHD_queue_response(conn, MHD_HTTP_INTERNAL_SERVER_ERROR, oom_resp);
        MHD_destroy_response(oom_resp);
        return ret;
      }
      int rc = payload_mgr_usb_move(path, overwrite, resp_buf, RESPONSE_BUFFER_SIZE);
      resp = MHD_create_response_from_buffer(strlen(resp_buf), (void *)resp_buf, MHD_RESPMEM_MUST_FREE);
      MHD_add_response_header(resp, "Content-Type", "application/json");
      add_cors_headers(resp);
      ret = MHD_queue_response(conn, rc == 0 ? MHD_HTTP_OK : MHD_HTTP_BAD_REQUEST, resp);
      MHD_destroy_response(resp);
      return ret;
    } else {
      const char *err = "{\"error\":\"Missing path\"}";
      resp = MHD_create_response_from_buffer(strlen(err), (void *)err, MHD_RESPMEM_MUST_COPY);
      MHD_add_response_header(resp, "Content-Type", "application/json");
    }
    add_cors_headers(resp);
    ret = MHD_queue_response(conn, MHD_HTTP_BAD_REQUEST, resp);
    MHD_destroy_response(resp);
    return ret;
  }

  /* Route: Index or index.html */
  if (strcmp(url, ROUTE_INDEX) == 0 || strcmp(url, ROUTE_INDEX_HTML) == 0) {
    resp = MHD_create_response_from_buffer(assets_index_html_len,
                                           (void *)assets_index_html,
                                           MHD_RESPMEM_PERSISTENT);
    MHD_add_response_header(resp, "Content-Type", "text/html");
    MHD_add_response_header(resp, "Cache-Control", "no-cache, must-revalidate");
  } else if (strcmp(url, ROUTE_CACHE_MANIFEST) == 0) {

    resp = MHD_create_response_from_buffer(assets_cache_appcache_len,
                                           (void *)assets_cache_appcache,
                                           MHD_RESPMEM_PERSISTENT);
    MHD_add_response_header(resp, "Content-Type", "text/cache-manifest");
    MHD_add_response_header(resp, "Cache-Control", "no-cache, must-revalidate");
  } else if (strcmp(url, "/favicon.svg") == 0) {
    resp = MHD_create_response_from_buffer(assets_favicon_svg_len,
                                           (void *)assets_favicon_svg,
                                           MHD_RESPMEM_PERSISTENT);
    MHD_add_response_header(resp, "Content-Type", "image/svg+xml");
    MHD_add_response_header(resp, "Cache-Control", "max-age=604800");
  } else if (strcmp(url, "/icon.png") == 0) {
    resp = MHD_create_response_from_buffer(assets_icon_png_len,
                                           (void *)assets_icon_png,
                                           MHD_RESPMEM_PERSISTENT);
    MHD_add_response_header(resp, "Content-Type", "image/png");
    MHD_add_response_header(resp, "Cache-Control", "max-age=604800");
  } else  if (strcmp(url, ROUTE_CHECK) == 0) {


    const char *filename = MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "filename");
    if (!filename) {
      const char *err = "{\"error\":\"Missing filename\"}";
      resp = MHD_create_response_from_buffer(strlen(err), (void *)err, MHD_RESPMEM_MUST_COPY);
      MHD_add_response_header(resp, "Content-Type", "application/json");
      add_cors_headers(resp);
      return MHD_queue_response(conn, MHD_HTTP_BAD_REQUEST, resp);
    }
    if (!is_safe_filename(filename)) {
      const char *err = "{\"error\":\"Invalid filename\"}";
      resp = MHD_create_response_from_buffer(strlen(err), (void *)err, MHD_RESPMEM_MUST_COPY);
      MHD_add_response_header(resp, "Content-Type", "application/json");
      add_cors_headers(resp);
      return MHD_queue_response(conn, MHD_HTTP_BAD_REQUEST, resp);
    }
    char *resp_buf;
    struct MHD_Response *oom_resp = alloc_response_buffer(&resp_buf);
    if (oom_resp)
      return MHD_queue_response(conn, MHD_HTTP_INTERNAL_SERVER_ERROR, oom_resp);
    payload_mgr_check_existing(filename, resp_buf, RESPONSE_BUFFER_SIZE);
    resp = MHD_create_response_from_buffer(strlen(resp_buf), (void *)resp_buf, MHD_RESPMEM_MUST_FREE);
    MHD_add_response_header(resp, "Content-Type", "application/json");
    add_cors_headers(resp);
    return MHD_queue_response(conn, MHD_HTTP_OK, resp);
  } else if (strcmp(url, ROUTE_LIST_PAYLOADS) == 0) {
    char *resp_buf;
    struct MHD_Response *oom_resp = alloc_response_buffer(&resp_buf);
    if (oom_resp)
      return MHD_queue_response(conn, MHD_HTTP_INTERNAL_SERVER_ERROR, oom_resp);
    size_t len = payload_mgr_list_json(resp_buf, RESPONSE_BUFFER_SIZE);
    resp = MHD_create_response_from_buffer(len, (void *)resp_buf,
                                           MHD_RESPMEM_MUST_FREE);
    MHD_add_response_header(resp, "Content-Type", "application/json");
  } else if (strcmp(url, ROUTE_PROCESSES_LIST) == 0) {
    char *resp_buf;
    struct MHD_Response *oom_resp = alloc_response_buffer(&resp_buf);
    if (oom_resp)
      return MHD_queue_response(conn, MHD_HTTP_INTERNAL_SERVER_ERROR, oom_resp);
    size_t len = payload_mgr_process_list_json(resp_buf, RESPONSE_BUFFER_SIZE);
    resp = MHD_create_response_from_buffer(len, (void *)resp_buf,
                                           MHD_RESPMEM_MUST_FREE);
    MHD_add_response_header(resp, "Content-Type", "application/json");
  } else if (strcmp(url, ROUTE_PROCESS_KILL) == 0) {
    const char *pid_str = MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "pid");
    if (!pid_str) {
      const char *err = "{\"ok\":false,\"message\":\"Missing pid\"}";
      resp = MHD_create_response_from_buffer(strlen(err), (void *)err, MHD_RESPMEM_MUST_COPY);
      MHD_add_response_header(resp, "Content-Type", "application/json");
      add_cors_headers(resp);
      return MHD_queue_response(conn, MHD_HTTP_BAD_REQUEST, resp);
    }
    int pid = atoi(pid_str);
    int rc = payload_mgr_process_kill(pid);
    char json_resp[256];
    snprintf(json_resp, sizeof(json_resp), "{\"ok\":%s,\"message\":\"%s\"}",
             rc == 0 ? "true" : "false", rc == 0 ? "Killed" : "Failed to kill");
    resp = MHD_create_response_from_buffer(strlen(json_resp), (void *)json_resp, MHD_RESPMEM_MUST_COPY);
    MHD_add_response_header(resp, "Content-Type", "application/json");
    add_cors_headers(resp);
    return MHD_queue_response(conn, rc == 0 ? MHD_HTTP_OK : MHD_HTTP_INTERNAL_SERVER_ERROR, resp);
  } else if (strcmp(url, ROUTE_REPO_LIST) == 0) {
    char *resp_buf;
    struct MHD_Response *oom_resp = alloc_response_buffer(&resp_buf);
    if (oom_resp)
      return MHD_queue_response(conn, MHD_HTTP_INTERNAL_SERVER_ERROR, oom_resp);
    int multi_en = 0, _a, _b, _c, _d, _e, _f;
    long _g;
    read_next_config_values(&_a, &_g, &_b, &_c, &_d, &_e, &_f, &multi_en);
    size_t len;
    if (multi_en)
      len = payload_mgr_multi_repository_list_json(resp_buf, RESPONSE_BUFFER_SIZE, 0);
    else
      len = payload_mgr_repository_list_json(resp_buf, RESPONSE_BUFFER_SIZE, 0);
    resp = MHD_create_response_from_buffer(len, (void *)resp_buf,
                                           MHD_RESPMEM_MUST_FREE);
    MHD_add_response_header(resp, "Content-Type", "application/json");
  } else if (strcmp(url, ROUTE_REPO_REFRESH) == 0) {
    char *resp_buf;
    struct MHD_Response *oom_resp = alloc_response_buffer(&resp_buf);
    if (oom_resp)
      return MHD_queue_response(conn, MHD_HTTP_INTERNAL_SERVER_ERROR, oom_resp);
    int multi_en2 = 0, _a2, _b2, _c2, _d2, _e2, _f2;
    long _g2;
    read_next_config_values(&_a2, &_g2, &_b2, &_c2, &_d2, &_e2, &_f2, &multi_en2);
    size_t len2;
    if (multi_en2)
      len2 = payload_mgr_multi_repository_list_json(resp_buf, RESPONSE_BUFFER_SIZE, 1);
    else
      len2 = payload_mgr_repository_list_json(resp_buf, RESPONSE_BUFFER_SIZE, 1);
    resp = MHD_create_response_from_buffer(len2, (void *)resp_buf,
                                           MHD_RESPMEM_MUST_FREE);
    MHD_add_response_header(resp, "Content-Type", "application/json");
  } else if (strcmp(url, ROUTE_REPO_INSTALL) == 0) {
    const char *filename = MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "filename");
    const char *repo_url = MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "repo_url");
    const char *source_id = MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "source_id");
    if (!filename) {
      const char *err = "{\"ok\":false,\"message\":\"Missing filename\"}";
      resp = MHD_create_response_from_buffer(strlen(err), (void *)err, MHD_RESPMEM_MUST_COPY);
      MHD_add_response_header(resp, "Content-Type", "application/json");
      add_cors_headers(resp);
      return MHD_queue_response(conn, MHD_HTTP_BAD_REQUEST, resp);
    }
    if (!is_safe_filename(filename)) {
      const char *err = "{\"ok\":false,\"message\":\"Invalid filename\"}";
      resp = MHD_create_response_from_buffer(strlen(err), (void *)err, MHD_RESPMEM_MUST_COPY);
      MHD_add_response_header(resp, "Content-Type", "application/json");
      add_cors_headers(resp);
      return MHD_queue_response(conn, MHD_HTTP_BAD_REQUEST, resp);
    }

    char msg_buf[1024] = "";
    int rc;
    /* Use multi-source install if source_id is provided */
    if (source_id && source_id[0]) {
      rc = payload_mgr_multi_repository_install(filename, source_id,
                                                repo_url ? repo_url : "",
                                                msg_buf, sizeof(msg_buf));
    } else {
      const char *detail = (repo_url && repo_url[0]) ? repo_url : REPOSITORY_SOURCE_URL;
      rc = payload_mgr_repository_install_download(filename, detail, msg_buf, sizeof(msg_buf));
    }
    if (msg_buf[0] == '\0') {
      snprintf(msg_buf, sizeof(msg_buf), rc == 0 ? "Installed" : "Install failed");
    }

    char json_resp[1024];
    snprintf(json_resp, sizeof(json_resp), "{\"ok\":%s,\"message\":\"%s\"}",
             rc == 0 ? "true" : "false", msg_buf);
    resp = MHD_create_response_from_buffer(strlen(json_resp), (void *)json_resp, MHD_RESPMEM_MUST_COPY);
    MHD_add_response_header(resp, "Content-Type", "application/json");
    add_cors_headers(resp);
    return MHD_queue_response(conn, rc == 0 ? MHD_HTTP_OK : MHD_HTTP_INTERNAL_SERVER_ERROR, resp);
  } else if (strcmp(url, ROUTE_SOURCES_LIST) == 0) {
    char *resp_buf;
    struct MHD_Response *oom_resp = alloc_response_buffer(&resp_buf);
    if (oom_resp)
      return MHD_queue_response(conn, MHD_HTTP_INTERNAL_SERVER_ERROR, oom_resp);
    payload_mgr_sources_list_json(resp_buf, RESPONSE_BUFFER_SIZE);
    resp = MHD_create_response_from_buffer(strlen(resp_buf), (void *)resp_buf, MHD_RESPMEM_MUST_FREE);
    MHD_add_response_header(resp, "Content-Type", "application/json");
  } else if (strcmp(url, ROUTE_SOURCES_ADD) == 0) {
    const char *src_url = MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "url");
    if (!src_url || !src_url[0]) {
      const char *err = "{\"ok\":false,\"message\":\"Missing url parameter\"}";
      resp = MHD_create_response_from_buffer(strlen(err), (void *)err, MHD_RESPMEM_MUST_COPY);
      MHD_add_response_header(resp, "Content-Type", "application/json");
      add_cors_headers(resp);
      return MHD_queue_response(conn, MHD_HTTP_BAD_REQUEST, resp);
    }
    char msg_buf_src[512] = "";
    int rc_src = payload_mgr_sources_add(src_url, msg_buf_src, sizeof(msg_buf_src));
    char json_resp_src[1024];
    if (rc_src == 0) {
      char name_escaped[512];
      pldmgr_json_escape(msg_buf_src, name_escaped, sizeof(name_escaped));
      snprintf(json_resp_src, sizeof(json_resp_src),
               "{\"ok\":true,\"name\":\"%s\"}", name_escaped);
    } else {
      char msg_escaped[512];
      pldmgr_json_escape(msg_buf_src, msg_escaped, sizeof(msg_escaped));
      snprintf(json_resp_src, sizeof(json_resp_src),
               "{\"ok\":false,\"message\":\"%s\"}", msg_escaped);
    }
    resp = MHD_create_response_from_buffer(strlen(json_resp_src), (void *)json_resp_src, MHD_RESPMEM_MUST_COPY);
    MHD_add_response_header(resp, "Content-Type", "application/json");
    add_cors_headers(resp);
    return MHD_queue_response(conn, rc_src == 0 ? MHD_HTTP_OK : MHD_HTTP_BAD_REQUEST, resp);
  } else if (strcmp(url, ROUTE_SOURCES_REMOVE) == 0) {
    const char *idx_str = MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "index");
    if (!idx_str) {
      const char *err = "{\"ok\":false,\"message\":\"Missing index parameter\"}";
      resp = MHD_create_response_from_buffer(strlen(err), (void *)err, MHD_RESPMEM_MUST_COPY);
      MHD_add_response_header(resp, "Content-Type", "application/json");
      add_cors_headers(resp);
      return MHD_queue_response(conn, MHD_HTTP_BAD_REQUEST, resp);
    }
    int idx = atoi(idx_str);
    char msg_rm[256] = "";
    int rc_rm = payload_mgr_sources_remove(idx, msg_rm, sizeof(msg_rm));
    char json_rm[512];
    char msg_rm_e[256];
    pldmgr_json_escape(msg_rm, msg_rm_e, sizeof(msg_rm_e));
    snprintf(json_rm, sizeof(json_rm), "{\"ok\":%s,\"message\":\"%s\"}",
             rc_rm == 0 ? "true" : "false", msg_rm_e);
    resp = MHD_create_response_from_buffer(strlen(json_rm), (void *)json_rm, MHD_RESPMEM_MUST_COPY);
    MHD_add_response_header(resp, "Content-Type", "application/json");
    add_cors_headers(resp);
    return MHD_queue_response(conn, rc_rm == 0 ? MHD_HTTP_OK : MHD_HTTP_BAD_REQUEST, resp);
  } else if (strncmp(url, ROUTE_LOAD_PAYLOAD, strlen(ROUTE_LOAD_PAYLOAD)) ==
             0) {
    const char *path = url + strlen(ROUTE_LOAD_PAYLOAD);
    const char *final_path = NULL;
    char resolved_path[512];
    if (is_allowed_payload_path(path)) {
      final_path = path;
    } else {
      const char *filename = strrchr(path, '/');
      filename = filename ? filename + 1 : path;
      if (is_safe_filename(filename) &&
          payload_mgr_resolve_path(filename, resolved_path,
                                   sizeof(resolved_path)) == 0) {
        final_path = resolved_path;
      }
    }

    if (!final_path) {
      pldmgr_log("[PLDMGR] !!! Payload path rejected: %s\n", path);
      const char *err = "Invalid payload name\n";
      resp = MHD_create_response_from_buffer(strlen(err), (void *)err,
                                             MHD_RESPMEM_PERSISTENT);
      http_status = MHD_HTTP_BAD_REQUEST;
    } else if (ps5_launch_elf(final_path) == 0) {
      resp = MHD_create_response_from_buffer(strlen(MSG_OK), (void *)MSG_OK,
                                             MHD_RESPMEM_PERSISTENT);
    } else {
      const char *err = "Failed to launch payload\n";
      resp = MHD_create_response_from_buffer(strlen(err), (void *)err,
                                             MHD_RESPMEM_PERSISTENT);
      http_status = MHD_HTTP_INTERNAL_SERVER_ERROR;
    }
    MHD_add_response_header(resp, "Content-Type", "text/plain");
  } else if (strncmp(url, ROUTE_DELETE, strlen(ROUTE_DELETE)) == 0) {
    const char *filename =
        MHD_lookup_connection_value(conn, MHD_GET_ARGUMENT_KIND, "filename");
    if (filename) {
      /* Basic safety: skip if filename contains / or .. */
      if (strstr(filename, "/") || strstr(filename, "..")) {
        const char *err = "Invalid filename\n";
        resp = MHD_create_response_from_buffer(strlen(err), (void *)err,
                                               MHD_RESPMEM_PERSISTENT);
      } else {
        if (payload_mgr_delete_payload_file(filename) == 0) {
          pldmgr_log("[PLDMGR] Deleted payload: %s\n", filename);
          resp = MHD_create_response_from_buffer(strlen(MSG_OK), (void *)MSG_OK,
                                                 MHD_RESPMEM_PERSISTENT);
        } else {
          const char *err = "Failed to delete file\n";
          resp = MHD_create_response_from_buffer(strlen(err), (void *)err,
                                                 MHD_RESPMEM_PERSISTENT);
        }
      }
    } else {
      const char *err = "Missing filename\n";
      resp = MHD_create_response_from_buffer(strlen(err), (void *)err,
                                             MHD_RESPMEM_PERSISTENT);
    }
    MHD_add_response_header(resp, "Content-Type", "text/plain");
  } else if (strcmp(url, ROUTE_SHUTDOWN) == 0) {
    const char *msg = "Payload Manager Core shutting down...\n";
    pldmgr_log("[PLDMGR] %s", msg);
    resp = MHD_create_response_from_buffer(strlen(msg), (void *)msg,
                                           MHD_RESPMEM_PERSISTENT);
    MHD_add_response_header(resp, "Content-Type", "text/plain");
    keep_running = 0; /* Signal main loop to exit */
  } else if (strcmp(url, ROUTE_LOG) == 0) {
    char *resp_buf;
    resp = alloc_response_buffer(&resp_buf);
    if (!resp) {
      size_t pos = 0;
      pos += snprintf(resp_buf + pos, RESPONSE_BUFFER_SIZE - pos,
                      "{\"logs\":[");
      for (int i = 0; i < log_count; i++) {
        int idx = (log_head - log_count + i + MAX_LOG_LINES) % MAX_LOG_LINES;
        char escaped[MAX_LOG_LINE_LEN * 2];
        pldmgr_json_escape(log_buffer[idx], escaped, sizeof(escaped));
        pos += snprintf(resp_buf + pos, RESPONSE_BUFFER_SIZE - pos,
                        "\"%s\"%s", escaped,
                        (i == log_count - 1) ? "" : ",");
      }
      pos += snprintf(resp_buf + pos, RESPONSE_BUFFER_SIZE - pos, "]}");
      resp = MHD_create_response_from_buffer(pos, (void *)resp_buf,
                                             MHD_RESPMEM_MUST_FREE);
      MHD_add_response_header(resp, "Content-Type", "application/json");
    }
  } else if (strcmp(url, ROUTE_VERSION) == 0) {
    resp = MHD_create_response_from_buffer(
        strlen(MENU_VERSION), (void *)MENU_VERSION, MHD_RESPMEM_PERSISTENT);
    MHD_add_response_header(resp, "Content-Type", "text/plain");
  } else if (strcmp(url, ROUTE_GETIP) == 0) {
    char ip[64];
    if (pldmgr_get_local_ip(ip, sizeof(ip)) != 0) {
      strcpy(ip, "0.0.0.0");
    }
    resp = MHD_create_response_from_buffer(strlen(ip), (void *)ip,
                                           MHD_RESPMEM_MUST_COPY);
    MHD_add_response_header(resp, "Content-Type", "text/plain");
  } else if (strcmp(url, ROUTE_AUTOLOAD_STATUS) == 0) {
    int total, done;
    char current[128];
    pldmgr_autoload_get_status(&total, &done, current);
    int remaining = pldmgr_autoload_get_remaining_seconds();
    long long remaining_ms = pldmgr_autoload_get_remaining_ms();

    char list_buf[4096] = "";
    FILE *f = fopen(AUTOLOAD_CONFIG_PATH, "r");
    if (f) {
      char line[256];
      int first = 1;
      while (fgets(line, sizeof(line), f)) {
        line[strcspn(line, "\r\n")] = 0;
        if (strlen(line) == 0 || line[0] == '!')
          continue;
        if (!first)
          strcat(list_buf, ",");
        strcat(list_buf, line);
        first = 0;
      }
      fclose(f);
    }

    int config_enabled, config_browser, config_delay, config_kill, config_usb, config_install, config_multi;
    long config_repo;
    read_next_config_values(&config_enabled, &config_repo, &config_browser,
                            &config_delay, &config_kill, &config_usb, &config_install, &config_multi);

    char current_escaped[256];
    char list_escaped[8192];
    pldmgr_json_escape(current, current_escaped, sizeof(current_escaped));
    pldmgr_json_escape(list_buf, list_escaped, sizeof(list_escaped));

    char *resp_buf;
    resp = alloc_response_buffer(&resp_buf);
    if (!resp) {
      snprintf(resp_buf, RESPONSE_BUFFER_SIZE,
               "{\"remaining\":%d,\"remaining_ms\":%lld,\"total\":%d,\"done\":%d,\"current\":\"%s\","
               "\"list\":\"%s\",\"delay\":%d,\"KILL_DISC_PLAYER_ON_STARTUP\":%s,\"SCAN_USB_PAYLOADS\":%s}",
               remaining, remaining_ms, total, done, current_escaped, list_escaped, config_delay,
               config_kill ? "true" : "false", config_usb ? "true" : "false");
      resp = MHD_create_response_from_buffer(strlen(resp_buf),
                                             (void *)resp_buf,
                                             MHD_RESPMEM_MUST_FREE);
      MHD_add_response_header(resp, "Content-Type", "application/json");
    }
  } else if (strcmp(url, ROUTE_AUTOLOAD_CLEAR) == 0) {
    pldmgr_autoload_reset();
    const char *msg = "Autoload status cleared.\n";
    resp = MHD_create_response_from_buffer(strlen(msg), (void *)msg,
                                           MHD_RESPMEM_PERSISTENT);
    MHD_add_response_header(resp, "Content-Type", "text/plain");
  } else if (strcmp(url, ROUTE_ABORT) == 0) {
    pldmgr_autoload_abort();
    const char *msg = "Autoload sequence aborted.\n";
    resp = MHD_create_response_from_buffer(strlen(msg), (void *)msg,
                                           MHD_RESPMEM_PERSISTENT);
    MHD_add_response_header(resp, "Content-Type", "text/plain");
  } else if (strcmp(url, "/autoload_status") == 0) {
    char resp_buf[64];
    snprintf(resp_buf, sizeof(resp_buf), "{\"remaining\":%d}",
             pldmgr_autoload_get_remaining_seconds());
    resp = MHD_create_response_from_buffer(strlen(resp_buf),
                                           (void *)resp_buf,
                                           MHD_RESPMEM_MUST_COPY);
    MHD_add_response_header(resp, "Content-Type", "application/json");
  } else if (strcmp(url, ROUTE_GET_CONFIG) == 0) {
    int enabled = 0, browser_open = 1, auto_delay = 5, kill_disc = 1, scan_usb = 0, auto_install = 1, multi_src = 0;
    long last_repo_update = 0;
    read_next_config_values(&enabled, &last_repo_update, &browser_open,
                            &auto_delay, &kill_disc, &scan_usb, &auto_install, &multi_src);

    /* Get list */
    char list_buf[4096] = {0};
    FILE *f = fopen(AUTOLOAD_CONFIG_PATH, "r");
    if (f) {
      char line[256];
      int first = 1;
      while (fgets(line, sizeof(line), f)) {
        line[strcspn(line, "\r\n")] = 0;
        if (strlen(line) == 0)
          continue;
        if (!first)
          strncat(list_buf, ",", sizeof(list_buf) - strlen(list_buf) - 1);
        strncat(list_buf, line, sizeof(list_buf) - strlen(list_buf) - 1);
        first = 0;
      }
      fclose(f);
    }

    char list_escaped[8192];
    pldmgr_json_escape(list_buf, list_escaped, sizeof(list_escaped));

    char *resp_buf;
    resp = alloc_response_buffer(&resp_buf);
    if (!resp) {
      snprintf(resp_buf, RESPONSE_BUFFER_SIZE,
               "{\"AUTOLOAD_ENABLED\":%s,\"AUTOLOAD_LIST\":\"%s\",\"LAST_"
               "REPOSITORY_UPDATE\":%ld,"
               "\"AUTO_BROWSER_OPEN\":%s,\"AUTOLOAD_DELAY\":%d,\"KILL_DISC_"
               "PLAYER_ON_STARTUP\":%s,\"SCAN_USB_PAYLOADS\":%s,\"AUTO_INSTALL_APP\":%s,"
               "\"MULTI_SOURCES_ENABLED\":%s}",
               enabled ? "true" : "false", list_escaped, last_repo_update,
               browser_open ? "true" : "false", auto_delay,
               kill_disc ? "true" : "false", scan_usb ? "true" : "false",
               auto_install ? "true" : "false",
               multi_src ? "true" : "false");
      resp = MHD_create_response_from_buffer(strlen(resp_buf),
                                             (void *)resp_buf,
                                             MHD_RESPMEM_MUST_FREE);
      MHD_add_response_header(resp, "Content-Type", "application/json");
    }
  } else if (strcmp(url, "/events") == 0) {
    struct LogSSEConnection *sse = malloc(sizeof(struct LogSSEConnection));
    sse->last_log_version = 0;
    sse->sent_initial = 0;

    resp = MHD_create_response_from_callback(
        MHD_SIZE_UNKNOWN, 1024, &log_stream_callback, sse, &log_stream_cleanup);
    MHD_add_response_header(resp, "Content-Type", "text/event-stream");
    MHD_add_response_header(resp, "Cache-Control", "no-cache");
    MHD_add_response_header(resp, "Connection", "keep-alive");
  } else {
    /* Default: 404 for now */
    const char *not_found = "404 Not Found\n";
    resp = MHD_create_response_from_buffer(strlen(not_found), (void *)not_found,
                                           MHD_RESPMEM_PERSISTENT);
    MHD_add_response_header(resp, "Content-Type", "text/plain");
  }

  if (!resp)
    return MHD_NO;

  /* Add CORS headers */
  add_cors_headers(resp);

  ret = MHD_queue_response(conn, http_status, resp);
  MHD_destroy_response(resp);

  return ret;
}

/* PS5 System Calls (Internal) */
extern int sceNetCtlInit();
extern int sceUserServiceInitialize(void *);

__attribute__((used)) volatile const char pldmgr_version_sig[] = "PLDMGR_VER:" MENU_VERSION;

int main(int argc, char *argv[]) {
  struct MHD_Daemon *daemon;
  unsigned short port = DEFAULT_PORT;
  pid_t pid;

  syscall(SYS_thr_set_name, -1, "pldmgr.elf");

  while((pid=find_pid("pldmgr.elf")) > 0) {
    if(kill(pid, SIGKILL)) {
      pldmgr_log("[PLDMGR] kill failed\n");
      return EXIT_FAILURE;
    }
    sleep(1);
  }

  pldmgr_log("[PLDMGR] Starting Payload Manager v%s on port %d...\n", pldmgr_version_sig + 11,
         port);

  /* Check for Self-Update */
  char new_payload_path[512];
  if (payload_mgr_check_self_update(new_payload_path, sizeof(new_payload_path)) == 0) {
    pldmgr_log("[PLDMGR] Found updated payload manager at %s. Launching...\n", new_payload_path);
    ps5_launch_elf(new_payload_path);
    return 0; /* Exit current process, new one will take over */
  }

  /* Initialize PS5 System Services */
  pldmgr_log("[PLDMGR] Initializing system services...\n");
  if (sceNetCtlInit() == 0) {
    pldmgr_log("[PLDMGR] Network Controller initialized.\n");
  }

  int user_prio = 256;
  if (sceUserServiceInitialize(&user_prio) == 0) {
    pldmgr_log("[PLDMGR] User Service initialized.\n");
  }

  /* Start Autoload Sequence (if config exists) */
  int ex_en, ex_br = 1, ex_del = 5, ex_kill = 1, ex_usb = 0, ex_install = 1, ex_multi = 0;
  long ex_repo = 0;
  read_next_config_values(&ex_en, &ex_repo, &ex_br, &ex_del, &ex_kill, &ex_usb, &ex_install, &ex_multi);

  /* Install app if requested */
  if (ex_install) {
    pldmgr_install_app_if_needed();
  }

  /* Kill Disc Player if running (BD-JB host) and enabled in config */
  if (ex_kill) {
    ps5_kill_disc_player();
  }

  /* Signal Resilience */
  signal(SIGPIPE, SIG_IGN);
  signal(SIGHUP, SIG_IGN);
  signal(SIGTERM, SIG_IGN);
  signal(SIGCONT, handle_sigcont);

  /* Start the MHD daemon */
  daemon = MHD_start_daemon(MHD_USE_THREAD_PER_CONNECTION | MHD_USE_DEBUG, port,
                            NULL, NULL, &on_request, NULL, MHD_OPTION_END);

  if (NULL == daemon) {
    pldmgr_log("[PLDMGR] Failed to start HTTP daemon!\n");
    pldmgr_notify("Error: HTTP Server Failed\nPort 8084 may be busy");
    return 1;
  }

  pldmgr_log("[PLDMGR] Server is running. Visit /shutdown to exit.\n");

  /* Try cache refresh (no-op if network unavailable; browser push handles
   * updates) */
  payload_mgr_repository_ensure_fresh(0);

  /* Automatically open browser to the menu URL (if enabled) */

  /* Startup Notification - Only show if browser autostart is off */
  char current_ip[64] = "unknown";
  pldmgr_get_local_ip(current_ip, sizeof(current_ip));

  if (!ex_br) {
    if (strcmp(current_ip, "unknown") != 0) {
      pldmgr_notify("Payload Manager v%s\nIP: %s\nPort: %d", MENU_VERSION, current_ip,
                port);
    } else {
      pldmgr_notify("Payload Manager v%s\nWaiting for Network...", MENU_VERSION);
    }
  }

  /* Start Autoload Sequence (if config exists) */
  pldmgr_autoload_start();

  if (ex_br) {
    char browser_url[128];
    snprintf(browser_url, sizeof(browser_url), "http://127.0.0.1:%d", port);
    ps5_launch_browser(browser_url);
  }

  /* Watchdog and main loop */
  int network_check_timer = 0;
  while (keep_running) {
    usleep(100000); /* 100ms sleep */

    /* Immediate Wake-up Recovery */
    if (resume_flag) {
      resume_flag = 0;
      pldmgr_log("[PLDMGR] Console resumed from standby. Refreshing network "
             "stack...\n");
      pldmgr_autoload_reset(); /* Reset UI state if needed */

      /* Force a check right now */
      network_check_timer = 50;
    }

    /* Network Watchdog (every 5 seconds) */
    if (++network_check_timer >= 50) {
      network_check_timer = 0;
      char new_ip[64] = "unknown";
      int has_ip = (pldmgr_get_local_ip(new_ip, sizeof(new_ip)) == 0);

      /* If IP changed or we recovered from no-IP state, or if we just resumed
       */
      if (has_ip && (strcmp(new_ip, current_ip) != 0 ||
                     strcmp(current_ip, "unknown") == 0)) {
        pldmgr_log("[PLDMGR] Network state refresh: %s -> %s. Restarting "
               "server...\n",
               current_ip, new_ip);
        if (daemon)
          MHD_stop_daemon(daemon);

        /* Give it a moment to release ports and for system to stabilize */
        usleep(800000);

        daemon = MHD_start_daemon(MHD_USE_THREAD_PER_CONNECTION | MHD_USE_DEBUG,
                                  port, NULL, NULL, &on_request, NULL,
                                  MHD_OPTION_END);

        if (daemon) {
          strcpy(current_ip, new_ip);
          pldmgr_log("[PLDMGR] Server restored on %s:%d\n", current_ip, port);
          pldmgr_notify("Payload Manager: Service Restored\nIP: %s", current_ip);
        } else {
          pldmgr_log("[PLDMGR] !!! Failed to restore server!\n");
        }
      } else if (!has_ip && strcmp(current_ip, "unknown") != 0) {
        /* Lost connection */
        pldmgr_log("[PLDMGR] Network lost (was %s)\n", current_ip);
        strcpy(current_ip, "unknown");
      }
    }
  }

  pldmgr_log("[PLDMGR] Shutting down...\n");
  if (daemon)
    MHD_stop_daemon(daemon);

  /* Give some time for sockets to close before process exits */
  sleep(1);

  return 0;
}
