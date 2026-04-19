# Next Menu

## Structure
- `src/`: C source files.
- `include/`: C header files.
- `frontend/`: React frontend source.
- `tools/`: Build scripts.

## How to Build

### 1. Build the Frontend
You must build the React UI first. This converts the JSX into the `dist/index.html` file that gets embedded.
```bash
make frontend-build
```

### 2. Build the SDK Docker Image
If you haven't already, build the SDK environment:
```bash
docker build -t nextmenu-sdk -f Dockerfile.sdk .
```

### 3. Build the ELF
Use the Docker container to compile Next Menu. It is recommended to run `make clean` if you updated the frontend.
```bash
docker run --rm -v $(pwd):/src -w /src nextmenu-sdk make clean all
```

The resulting `next_menu.elf` will be created in the root directory.

## Deploy
1. Upload `next_menu.elf` to your PS5 (e.g., via port 9021).
2. The menu will be available at `http://[PS5_IP]:50005`.
