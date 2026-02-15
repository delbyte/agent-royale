
import os
import struct
import zlib

def write_png(buf, width, height):
    # Reverse the rows for PNG
    # This is a very minimal PNG writer
    
    # Signature
    png = b'\x89PNG\r\n\x1a\n'
    
    # IHDR
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    png += b'\x00\x00\x00\x0D' + b'IHDR' + ihdr + struct.pack('>I', zlib.crc32(b'IHDR' + ihdr) & 0xFFFFFFFF)
    
    # IDAT
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00' # Filter type 0 (None)
        start = y * width * 3
        raw_data += buf[start:start + width * 3]
        
    compressed = zlib.compress(raw_data)
    png += struct.pack('>I', len(compressed)) + b'IDAT' + compressed + struct.pack('>I', zlib.crc32(b'IDAT' + compressed) & 0xFFFFFFFF)
    
    # IEND
    png += b'\x00\x00\x00\x00IEND' + struct.pack('>I', zlib.crc32(b'IEND') & 0xFFFFFFFF)
    
    return png

def main():
    width = 16
    height = 16
    buffer = bytearray()
    
    # Generate colorful pattern
    for y in range(height):
        for x in range(width):
            # RGB
            buffer.append((x * 16) % 256) # R
            buffer.append((y * 16) % 256) # G
            buffer.append(((x+y) * 16) % 256) # B
            
    png_data = write_png(buffer, width, height)
    
    paths = [
        "public/assets/models/environment/Textures/colormap.png",
        "public/assets/models/characters/Textures/colormap.png"
    ]
    
    for path in paths:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(png_data)
        print(f"Saved custom colorful PNG to {path}")

if __name__ == "__main__":
    main()
