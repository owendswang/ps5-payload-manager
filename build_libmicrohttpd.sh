#!/usr/bin/env bash
# Internal script to build libmicrohttpd for the PS5 SDK inside Docker
set -e

LIB_URL="https://ftp.gnu.org/gnu/libmicrohttpd/"
LIB_VER="1.0.1"

# We use the SDK's bin path
export PATH="/opt/ps5-payload-sdk/bin:$PATH"

TEMPDIR=$(mktemp -d)
# trap 'rm -rf -- "$TEMPDIR"' EXIT

echo "Downloading libmicrohttpd..."
wget -O $TEMPDIR/lib.tar.gz $LIB_URL/libmicrohttpd-$LIB_VER.tar.gz
tar xf $TEMPDIR/lib.tar.gz -C $TEMPDIR

cd $TEMPDIR/libmicrohttpd-$LIB_VER

echo "Configuring libmicrohttpd for PS5 using SDK toolchain..."
# CRITICAL: Use the SDK's prospero-clang wrapper to ensure PS5 ABI compatibility
export CC=prospero-clang
export CXX=prospero-clang++
export AR=prospero-ar
export NM=prospero-nm
export RANLIB=prospero-ranlib

# Use the target architecture that prospero-clang expects
./configure --host=x86_64-pc-freebsd12 \
            --disable-shared --enable-static \
            --disable-curl --disable-examples \
            --prefix=/opt/ps5-payload-sdk/target

echo "Building..."
make -j$(nproc)
echo "Installing to SDK..."
make install
