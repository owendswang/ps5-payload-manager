# Next Menu - Native PS5 ELF Daemon Makefile

# Tools
PYTHON := python3
CC     := /opt/ps5-payload-sdk/bin/prospero-clang

# Paths
SDK      := /opt/ps5-payload-sdk
TARGET   := $(SDK)/target
INCLUDES := -Iinclude -I$(TARGET)/include
LIBS     := -L$(TARGET)/lib -lmicrohttpd

# Source Files
SRCS := src/main.c src/payload_mgr.c src/ps5_launcher.c
OBJS := $(SRCS:.c=.o)
ELF  := next_menu.elf

# Assets
FRONTEND_DIST := frontend/dist/index.html
ASSET_HEADER  := include/assets_index_html.h

# Compiler Flags
CFLAGS := -g -O2 -Wall $(INCLUDES)

all: $(ELF)

# Build the React frontend
.PHONY: frontend-build
frontend-build:
	@echo "Building frontend..."
	cd frontend && npm install && npm run build

$(ASSET_HEADER): $(FRONTEND_DIST)
	@echo "Generating asset header..."
	$(PYTHON) tools/gen_assets.py $(FRONTEND_DIST) $(ASSET_HEADER) index_html

$(FRONTEND_DIST):
	@echo "ERROR: frontend/dist/index.html not found!"
	@echo "Please run 'make frontend-build' locally on your host machine first."
	@exit 1

$(ELF): $(ASSET_HEADER) $(SRCS)
	@echo "Building $(ELF)..."
	$(CC) $(CFLAGS) -o $(ELF) $(SRCS) $(LIBS)

clean:
	rm -f $(ELF) $(ASSET_HEADER) src/*.o

dist-clean: clean
	rm -rf frontend/dist

.PHONY: all clean frontend-build dist-clean
