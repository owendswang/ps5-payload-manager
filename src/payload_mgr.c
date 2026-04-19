#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dirent.h>
#include <sys/stat.h>
#include "payload_mgr.h"
#include "next_menu.h"

static const char **scan_dirs = (const char **)SCAN_DIRS;
static const int scan_dirs_count = SCAN_DIRS_COUNT;

/* Helper to check if a file has a supported extension */
static int is_supported_extension(const char *filename) {
    const char *ext = strrchr(filename, '.');
    if (!ext) return 0;
    
    if (strcasecmp(ext, ".elf") == 0) return 1;
    if (strcasecmp(ext, ".bin") == 0) return 1;
    
    return 0;
}

size_t payload_mgr_list_json(char *json_buf, size_t buf_size) {
    size_t pos = 0;
    int first = 1;

    /* Ensure the managed directory exists */
    mkdir(BASE_DATA_DIR, 0777);

    pos += snprintf(json_buf + pos, buf_size - pos, "{\"payloads\":[");

    for (int i = 0; i < scan_dirs_count; i++) {
        const char *dir_path = scan_dirs[i];
        DIR *dir = opendir(dir_path);
        if (!dir) continue;

        printf("[NextMenu] Scanning: %s\n", dir_path);

        struct dirent *entry;
        while ((entry = readdir(dir)) != NULL) {
            if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;

            char full_path[512];
            snprintf(full_path, sizeof(full_path), "%s/%s", dir_path, entry->d_name);

            struct stat st;
            if (stat(full_path, &st) != 0) continue;

            if (S_ISREG(st.st_mode)) {
                if (is_supported_extension(entry->d_name)) {
                    printf("[NextMenu] Found payload: %s\n", full_path);
                    if (!first) {
                        pos += snprintf(json_buf + pos, buf_size - pos, ",");
                    }
                    
                    /* Just output the path as a string to match frontend expectations */
                    pos += snprintf(json_buf + pos, buf_size - pos, "\"%s\"", full_path);
                    
                    first = 0;
                }
            }
            
            if (pos > buf_size - 512) break;
        }
        closedir(dir);
        if (pos > buf_size - 512) break;
    }

    pos += snprintf(json_buf + pos, buf_size - pos, "]}");
    return pos;
}
