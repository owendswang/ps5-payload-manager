#pragma once

#include <stdint.h>
#include <sys/types.h>

/**
 * Launch an ELF payload from the filesystem.
 * @param path Full path to the .elf or .bin file.
 * @return 0 on success, -1 on failure.
 */
int ps5_launch_elf(const char* path);
