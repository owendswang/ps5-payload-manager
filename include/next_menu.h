#pragma once

/* Network Settings */
#define MENU_PORT 50005
#define ELFLDR_PORT 9021

/* Routes */
#define ROUTE_INDEX "/"
#define ROUTE_INDEX_HTML "/index.html"
#define ROUTE_LIST_PAYLOADS "/list_payloads"
#define ROUTE_UPLOAD "/manage:upload"
#define ROUTE_DELETE "/manage:delete"
#define ROUTE_LOAD_PAYLOAD "/loadpayload:"
#define ROUTE_SHUTDOWN "/shutdown"

/* Paths */
#define BASE_DATA_DIR "/data/next_menu"

/* Scan Locations (Internal + 8 USB ports) */
static const char* SCAN_DIRS[] = {
    "/data/next_menu",
    "/mnt/usb0/next_menu",
    "/mnt/usb1/next_menu",
    "/mnt/usb2/next_menu",
    "/mnt/usb3/next_menu",
    "/mnt/usb4/next_menu",
    "/mnt/usb5/next_menu",
    "/mnt/usb6/next_menu",
    "/mnt/usb7/next_menu"
};
#define SCAN_DIRS_COUNT 9

/* Messages */
#define MSG_OK "OK"
