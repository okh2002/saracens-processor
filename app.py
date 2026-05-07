import os
import io
import json
import math
import zipfile
import tempfile
import shutil
import struct
import zlib
import numpy as np
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from PIL import Image, ImageDraw
import boto3
from botocore.client import Config

app = Flask(__name__)
CORS(app)

# ── Backblaze B2 client ───────────────────────────────────────────────────────
def get_b2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ.get('B2_ENDPOINT')}",
        aws_access_key_id=os.environ.get("B2_KEY_ID"),
        aws_secret_access_key=os.environ.get("B2_APP_KEY"),
        config=Config(signature_version="s3v4"),
    )

BUCKET = os.environ.get("B2_BUCKET", "saracens-worlds")

def upload_to_b2(local_path, key):
    client = get_b2_client()
    client.upload_file(local_path, BUCKET, key)

def upload_bytes_to_b2(data: bytes, key: str, content_type: str = "application/octet-stream"):
    client = get_b2_client()
    client.put_object(Bucket=BUCKET, Key=key, Body=data, ContentType=content_type)

def get_presigned_url(key: str, expiry: int = 86400) -> str:
    client = get_b2_client()
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=expiry,
    )
    return url

def download_from_b2(key: str) -> bytes:
    client = get_b2_client()
    obj = client.get_object(Bucket=BUCKET, Key=key)
    return obj["Body"].read()

# ── Octagon helper ────────────────────────────────────────────────────────────
def is_inside_octagon(x, z, cx=520, cz=520, size=400):
    dx = abs(x - cx)
    dz = abs(z - cz)
    if dx > size or dz > size:
        return False
    return dx + dz <= size * 1.414

# ── Minecraft world writer (pure Python, no anvil needed for generation) ──────
# We write a minimal valid Minecraft Java Edition world using NBT format

def write_nbt_string(name: str, value: str) -> bytes:
    name_bytes = name.encode("utf-8")
    value_bytes = value.encode("utf-8")
    return (
        b"\x08"  # TAG_String
        + struct.pack(">H", len(name_bytes)) + name_bytes
        + struct.pack(">H", len(value_bytes)) + value_bytes
    )

def write_nbt_int(name: str, value: int) -> bytes:
    name_bytes = name.encode("utf-8")
    return (
        b"\x03"  # TAG_Int
        + struct.pack(">H", len(name_bytes)) + name_bytes
        + struct.pack(">i", value)
    )

def write_nbt_long(name: str, value: int) -> bytes:
    name_bytes = name.encode("utf-8")
    return (
        b"\x04"  # TAG_Long
        + struct.pack(">H", len(name_bytes)) + name_bytes
        + struct.pack(">q", value)
    )

def write_nbt_byte(name: str, value: int) -> bytes:
    name_bytes = name.encode("utf-8")
    return (
        b"\x01"  # TAG_Byte
        + struct.pack(">H", len(name_bytes)) + name_bytes
        + struct.pack(">b", value)
    )

def make_level_dat() -> bytes:
    """Create a minimal level.dat NBT file"""
    # Build Data compound content
    data_content = (
        write_nbt_int("version", 19133) +
        write_nbt_string("LevelName", "SaracensCity") +
        write_nbt_string("generatorName", "flat") +
        write_nbt_int("GameType", 1) +  # Creative
        write_nbt_byte("allowCommands", 1) +
        write_nbt_long("RandomSeed", 0) +
        write_nbt_long("Time", 6000) +  # Midday
        write_nbt_int("SpawnX", 520) +
        write_nbt_int("SpawnY", 80) +
        write_nbt_int("SpawnZ", 520) +
        write_nbt_byte("Difficulty", 0)  # Peaceful
    )

    # TAG_Compound named "Data"
    data_name = "Data".encode("utf-8")
    data_tag = (
        b"\x0a"  # TAG_Compound
        + struct.pack(">H", len(data_name)) + data_name
        + data_content
        + b"\x00"  # TAG_End
    )

    # Root compound (unnamed)
    root = b"\x0a\x00\x00" + data_tag + b"\x00"

    # Compress with gzip
    buf = io.BytesIO()
    import gzip
    with gzip.GzipFile(fileobj=buf, mode="wb") as f:
        f.write(root)
    return buf.getvalue()

def get_block_id(elevation: float, inside_octagon: bool, y_world: int) -> int:
    """
    Returns Minecraft block ID based on elevation and position.
    Block IDs (legacy):
    0  = air
    7  = bedrock
    1  = stone
    3  = dirt
    2  = grass
    12 = sand
    9  = water (stationary)
    80 = snow
    13 = gravel
    """
    if not inside_octagon:
        # Sea margin - water or seabed
        if y_world == 0:
            return 7   # bedrock
        if y_world < 60:
            return 1   # stone
        if y_world == 60:
            return 12  # sand seabed
        if y_world <= 62:
            return 9   # water
        return 0       # air

    # Inside octagon
    sea_level = 62
    max_height = 100

    if elevation < 0.15:
        # Underwater
        terrain_y = 55 + int(elevation * 40)
        if y_world == 0: return 7
        if y_world < terrain_y - 2: return 1
        if y_world < terrain_y: return 12
        if y_world <= sea_level: return 9
        return 0

    if elevation < 0.25:
        # Beach
        terrain_y = sea_level + 1
        if y_world == 0: return 7
        if y_world < terrain_y - 1: return 1
        if y_world < terrain_y: return 3
        if y_world == terrain_y: return 12
        return 0

    if elevation < 0.5:
        # Lowlands - grass
        terrain_y = sea_level + 1 + int((elevation - 0.25) * 60)
        if y_world == 0: return 7
        if y_world < terrain_y - 3: return 1
        if y_world < terrain_y: return 3
        if y_world == terrain_y: return 2
        return 0

    if elevation < 0.75:
        # Highlands
        terrain_y = sea_level + 16 + int((elevation - 0.5) * 60)
        if y_world == 0: return 7
        if y_world < terrain_y - 2: return 1
        if y_world < terrain_y: return 3
        if y_world == terrain_y: return 2
        return 0

    # Mountain peaks
    terrain_y = sea_level + 31 + int((elevation - 0.75) * 80)
    terrain_y = min(terrain_y, max_height)
    snow_level = 88
    if y_world == 0: return 7
    if y_world < terrain_y - 2: return 1
    if y_world < terrain_y: return 13  # gravel
    if y_world == terrain_y:
        return 80 if terrain_y > snow_level else 1
    return 0

def make_region_file(chunks_data: dict) -> bytes:
    """
    chunks_data: dict of (chunk_x, chunk_z) -> 3D array of block IDs [y][x][z] 16x256x16
    Returns bytes of a valid .mca region file
    """
    SECTOR_SIZE = 4096
    chunk_count = 32 * 32

    # We'll store chunk locations and data
    locations = [0] * chunk_count
    timestamps = [0] * chunk_count
    chunk_sectors = []

    current_sector = 2  # First two sectors are header

    for cz in range(32):
        for cx in range(32):
            key = (cx, cz)
            if key not in chunks_data:
                continue

            blocks = chunks_data[key]  # [y][x_local][z_local]

            # Build minimal chunk NBT
            sections = []
            for section_y in range(16):  # 16 sections of 16 blocks each
                y_start = section_y * 16
                block_ids = []
                has_blocks = False
                for y in range(16):
                    for z in range(16):
                        for x in range(16):
                            world_y = y_start + y
                            bid = blocks[world_y][x][z] if world_y < 256 else 0
                            block_ids.append(bid)
                            if bid != 0:
                                has_blocks = True

                if not has_blocks:
                    continue

                # Build section NBT
                blocks_bytes = bytes(min(b, 255) for b in block_ids)
                add_bytes = bytes(len(block_ids) // 2)
                data_bytes = bytes(len(block_ids) // 2)
                skylight = bytes([0xFF] * (len(block_ids) // 2))
                blocklight = bytes(len(block_ids) // 2)

                section_name = "Sections".encode("utf-8")
                y_tag = b"\x01\x00\x01Y" + struct.pack(">b", section_y)
                blocks_name = "Blocks".encode("utf-8")
                blocks_tag = (b"\x07" + struct.pack(">H", len(blocks_name)) + blocks_name +
                             struct.pack(">i", len(blocks_bytes)) + blocks_bytes)

                section_compound = b"\x0a\x00\x00" + y_tag + blocks_tag + b"\x00"
                sections.append(section_compound)

            # Build level compound
            cx_tag = write_nbt_int("xPos", cx)
            cz_tag = write_nbt_int("zPos", cz)
            v_tag = write_nbt_byte("V", 1)

            level_name = "Level".encode("utf-8")
            level_content = cx_tag + cz_tag + v_tag
            level_tag = b"\x0a" + struct.pack(">H", len(level_name)) + level_name + level_content + b"\x00"

            chunk_nbt = b"\x0a\x00\x00" + level_tag + b"\x00"

            # Compress chunk data
            compressed = zlib.compress(chunk_nbt)
            chunk_len = len(compressed) + 1  # +1 for compression type byte
            chunk_bytes = struct.pack(">i", chunk_len) + b"\x02" + compressed  # 2 = zlib

            # Pad to sector boundary
            padded_len = math.ceil(len(chunk_bytes) / SECTOR_SIZE) * SECTOR_SIZE
            chunk_bytes = chunk_bytes + b"\x00" * (padded_len - len(chunk_bytes))

            sector_count = padded_len // SECTOR_SIZE

            chunk_index = cz * 32 + cx
            locations[chunk_index] = (current_sector << 8) | sector_count
            timestamps[chunk_index] = 0
            chunk_sectors.append(chunk_bytes)
            current_sector += sector_count

    # Build header
    loc_bytes = b"".join(struct.pack(">I", l) for l in locations)
    ts_bytes = b"".join(struct.pack(">I", t) for t in timestamps)
    header = loc_bytes + ts_bytes  # 8192 bytes total

    return header + b"".join(chunk_sectors)

def generate_world_from_heightmap(heightmap: list, city_id: str, tmp_dir: str) -> str:
    """Generate a Minecraft world from heightmap. Returns path to zip file."""
    world_dir = os.path.join(tmp_dir, f"SaracensCity_{city_id}")
    region_dir = os.path.join(world_dir, "region")
    os.makedirs(region_dir, exist_ok=True)

    # Write level.dat
    with open(os.path.join(world_dir, "level.dat"), "wb") as f:
        f.write(make_level_dat())

    # Convert heightmap to numpy - scale to world coords
    hm = np.array(heightmap, dtype=np.float32)
    # Resize to 1040x1040 if needed
    if hm.shape != (1040, 1040):
        from PIL import Image as PILImage
        img = PILImage.fromarray((hm * 255).astype(np.uint8))
        img = img.resize((1040, 1040), PILImage.BILINEAR)
        hm = np.array(img, dtype=np.float32) / 255.0

    print(f"Generating world {city_id} - {hm.shape}")

    # Group chunks by region file
    # Region files cover 32x32 chunks = 512x512 blocks
    # World is 1040x1040 so we need region files (0,0) and (1,1) at minimum
    regions = {}  # (rx, rz) -> {(lcx, lcz) -> blocks}

    WORLD_SIZE = 1040
    total_chunks_x = math.ceil(WORLD_SIZE / 16)
    total_chunks_z = math.ceil(WORLD_SIZE / 16)

    for chunk_x in range(total_chunks_x):
        for chunk_z in range(total_chunks_z):
            rx = chunk_x // 32
            rz = chunk_z // 32
            lcx = chunk_x % 32
            lcz = chunk_z % 32

            # Build 16x256x16 block array for this chunk
            blocks = [[[0] * 16 for _ in range(16)] for _ in range(256)]

            for lx in range(16):
                for lz in range(16):
                    world_x = chunk_x * 16 + lx
                    world_z = chunk_z * 16 + lz

                    if world_x >= WORLD_SIZE or world_z >= WORLD_SIZE:
                        continue

                    elev = float(hm[world_z, world_x])
                    inside = is_inside_octagon(world_x, world_z)

                    for y in range(256):
                        blocks[y][lx][lz] = get_block_id(elev, inside, y)

            region_key = (rx, rz)
            if region_key not in regions:
                regions[region_key] = {}
            regions[region_key][(lcx, lcz)] = blocks

    # Write region files
    for (rx, rz), chunks in regions.items():
        region_path = os.path.join(region_dir, f"r.{rx}.{rz}.mca")
        region_bytes = make_region_file(chunks)
        with open(region_path, "wb") as f:
            f.write(region_bytes)
        print(f"  Wrote region r.{rx}.{rz}.mca - {len(region_bytes)} bytes")

    # Zip the world
    zip_path = os.path.join(tmp_dir, f"{city_id}_world.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(world_dir):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, tmp_dir)
                zf.write(file_path, arcname)

    print(f"World zip created: {zip_path}")
    return zip_path

# ── Isometric renderer ────────────────────────────────────────────────────────
BLOCK_COLORS = {
    2:  ((106,127,75),  (79,96,56),    (91,111,64)),   # grass
    1:  ((125,125,125), (100,100,100), (112,112,112)), # stone
    3:  ((134,96,67),   (107,77,54),   (120,86,60)),   # dirt
    12: ((219,207,163), (175,166,130), (197,186,146)), # sand
    9:  ((64,147,212),  (51,117,169),  (57,132,190)),  # water
    80: ((255,255,255), (204,204,204), (229,229,229)), # snow
    13: ((136,126,126), (109,101,101), (122,113,113)), # gravel
    7:  ((21,21,21),    (17,17,17),    (19,19,19)),    # bedrock
    0:  None,  # air - skip
}
SEA_COLOR = (10, 22, 40)

def world_to_iso(x, y, z, tw=4, th=2):
    sx = (x - z) * tw
    sy = (x + z) * th - y * 4
    return sx, sy

def render_isometric(blocks_3d: np.ndarray, output_size=(800, 600)) -> Image.Image:
    """
    blocks_3d: numpy array [y, x, z] of block IDs
    Renders isometric view
    """
    W, H = output_size
    img = Image.new("RGBA", (W, H), (10, 22, 40, 255))
    draw = ImageDraw.Draw(img)

    depth, size_x, size_z = blocks_3d.shape

    # Find bounds for centering
    # Sample every 4th block for performance
    step = 4
    tw, th = 4, 2

    cx = W // 2
    cy = H // 2

    # Render back to front (painter's algorithm)
    # Order: increasing x+z (back to front in isometric)
    for diagonal in range(size_x + size_z - 1):
        for x in range(max(0, diagonal - size_z + 1), min(diagonal + 1, size_x)):
            z = diagonal - x
            if z < 0 or z >= size_z:
                continue

            inside = is_inside_octagon(x, z)

            for y in range(depth - 1, -1, -1):
                bid = int(blocks_3d[y, x, z])
                if bid == 0:
                    continue

                colors = BLOCK_COLORS.get(bid)
                if colors is None:
                    continue

                # Check if top face is visible (block above is air)
                top_visible = (y == depth - 1) or (blocks_3d[y + 1, x, z] == 0)
                # Only render if top visible or it's a surface block
                if not top_visible:
                    break

                sx, sy = world_to_iso(x, y, z, tw, th)
                px = cx + sx
                py = cy + sy

                top_c, left_c, right_c = colors

                # Draw top face (diamond shape)
                top_pts = [
                    (px, py - th),
                    (px + tw, py),
                    (px, py + th),
                    (px - tw, py),
                ]
                draw.polygon(top_pts, fill=top_c)

                # Draw left face
                left_pts = [
                    (px - tw, py),
                    (px, py + th),
                    (px, py + th + th),
                    (px - tw, py + th),
                ]
                draw.polygon(left_pts, fill=left_c)

                # Draw right face
                right_pts = [
                    (px + tw, py),
                    (px, py + th),
                    (px, py + th + th),
                    (px + tw, py + th),
                ]
                draw.polygon(right_pts, fill=right_c)

                break  # Only render top visible block per column

    return img

# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "alive", "service": "saracens-processor"})

@app.route("/generate-world", methods=["POST"])
def generate_world():
    try:
        data = request.get_json()
        heightmap = data.get("heightmap")
        city_id = data.get("city_id", "unknown")

        if not heightmap:
            return jsonify({"success": False, "error": "No heightmap provided"}), 400

        tmp_dir = tempfile.mkdtemp()
        try:
            zip_path = generate_world_from_heightmap(heightmap, city_id, tmp_dir)

            # Upload to B2
            b2_key = f"worlds/{city_id}/world.zip"
            upload_to_b2(zip_path, b2_key)

            # Get presigned download URL
            download_url = get_presigned_url(b2_key)

            return jsonify({
                "success": True,
                "download_url": download_url,
                "city_id": city_id,
                "message": "تم توليد العالم بنجاح"
            })

        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    except Exception as e:
        print(f"Error generating world: {e}")
        import traceback; traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/process-world-upload", methods=["POST"])
def process_world_upload():
    try:
        city_id = request.form.get("city_id", "unknown")
        world_zip = request.files.get("world_zip")

        if not world_zip:
            return jsonify({"success": False, "error": "No world zip provided"}), 400

        tmp_dir = tempfile.mkdtemp()
        try:
            # Save uploaded zip
            zip_path = os.path.join(tmp_dir, "upload.zip")
            world_zip.save(zip_path)

            # Extract world
            extract_dir = os.path.join(tmp_dir, "world")
            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(extract_dir)

            # Find region directory
            region_dir = None
            for root, dirs, files in os.walk(extract_dir):
                if "region" in dirs:
                    region_dir = os.path.join(root, "region")
                    break

            if not region_dir:
                return jsonify({"success": False, "error": "No region directory found in world"}), 400

            # Extract blocks centered at (520, 520)
            # We'll read region files and build a downsampled block array
            SAMPLE_SIZE = 256  # Sample to 256x256 for rendering
            WORLD_SIZE = 1040
            CENTER_X, CENTER_Z = 520, 520
            HALF = WORLD_SIZE // 2

            blocks_top = np.zeros((SAMPLE_SIZE, SAMPLE_SIZE), dtype=np.uint8)

            import re
            mca_files = [f for f in os.listdir(region_dir) if f.endswith(".mca")]

            for mca_file in mca_files:
                match = re.match(r"r\.(-?\d+)\.(-?\d+)\.mca", mca_file)
                if not match:
                    continue

                rx, rz = int(match.group(1)), int(match.group(2))
                mca_path = os.path.join(region_dir, mca_file)

                try:
                    import anvil
                    region = anvil.Region.from_file(mca_path)

                    for chunk_x in range(32):
                        for chunk_z in range(32):
                            try:
                                chunk = region.get_chunk(chunk_x, chunk_z)
                            except Exception:
                                continue

                            abs_cx = rx * 32 + chunk_x
                            abs_cz = rz * 32 + chunk_z

                            for lx in range(16):
                                for lz in range(16):
                                    world_x = abs_cx * 16 + lx
                                    world_z = abs_cz * 16 + lz

                                    # Map to sample coordinates
                                    sx = int((world_x / WORLD_SIZE) * SAMPLE_SIZE)
                                    sz = int((world_z / WORLD_SIZE) * SAMPLE_SIZE)

                                    if sx >= SAMPLE_SIZE or sz >= SAMPLE_SIZE:
                                        continue

                                    # Find top block
                                    for y in range(255, -1, -1):
                                        try:
                                            block = chunk.get_block(lx, y, lz)
                                            if block and block.id not in ("minecraft:air", "air", ""):
                                                name = block.id.replace("minecraft:", "")
                                                bid = {
                                                    "grass_block": 2, "stone": 1, "dirt": 3,
                                                    "sand": 12, "water": 9, "snow": 80,
                                                    "gravel": 13, "bedrock": 7,
                                                    "oak_log": 17, "oak_leaves": 18,
                                                }.get(name, 1)
                                                blocks_top[sz, sx] = bid
                                                break
                                        except Exception:
                                            break
                except Exception as e:
                    print(f"Error reading {mca_file}: {e}")
                    continue

            # Save schematic as numpy array
            schematic_path = os.path.join(tmp_dir, "schematic.npy")
            np.save(schematic_path, blocks_top)

            # Upload schematic to B2
            schematic_key = f"schematics/{city_id}/schematic.npy"
            upload_to_b2(schematic_path, schematic_key)

            # Generate isometric render from top blocks
            render_img = render_from_top_blocks(blocks_top)
            render_path = os.path.join(tmp_dir, "render.png")
            render_img.save(render_path, "PNG")

            render_key = f"renders/{city_id}/render.png"
            upload_to_b2(render_path, render_key)
            render_url = get_presigned_url(render_key, expiry=86400 * 30)

            return jsonify({
                "success": True,
                "schematic_key": schematic_key,
                "render_url": render_url,
                "city_id": city_id,
                "message": "تم معالجة العالم بنجاح"
            })

        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    except Exception as e:
        print(f"Error processing upload: {e}")
        import traceback; traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/generate-render", methods=["POST"])
def generate_render():
    try:
        data = request.get_json()
        city_id = data.get("city_id", "unknown")
        schematic_key = data.get("schematic_key")

        if not schematic_key:
            return jsonify({"success": False, "error": "No schematic key provided"}), 400

        tmp_dir = tempfile.mkdtemp()
        try:
            # Download schematic from B2
            schematic_bytes = download_from_b2(schematic_key)
            schematic_path = os.path.join(tmp_dir, "schematic.npy")
            with open(schematic_path, "wb") as f:
                f.write(schematic_bytes)

            blocks_top = np.load(schematic_path)

            # Generate render
            render_img = render_from_top_blocks(blocks_top)
            render_path = os.path.join(tmp_dir, "render.png")
            render_img.save(render_path, "PNG")

            # Upload render
            render_key = f"renders/{city_id}/render.png"
            upload_to_b2(render_path, render_key)
            render_url = get_presigned_url(render_key, expiry=86400 * 30)

            return jsonify({
                "success": True,
                "render_url": render_url,
                "city_id": city_id
            })

        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    except Exception as e:
        print(f"Error generating render: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


def render_from_top_blocks(blocks_top: np.ndarray, output_size=(800, 600)) -> Image.Image:
    """
    Fast isometric render from a 2D top-down block array.
    blocks_top: [z, x] array of block IDs
    """
    W, H = output_size
    img = Image.new("RGBA", (W, H), (10, 22, 40, 255))
    draw = ImageDraw.Draw(img)

    size_z, size_x = blocks_top.shape
    tw, th = 3, 1

    cx = W // 2
    cy = H // 2

    # Isometric offset for centering
    offset_x = 0
    offset_y = -(size_x + size_z) * th // 2

    for diagonal in range(size_x + size_z - 1):
        for x in range(max(0, diagonal - size_z + 1), min(diagonal + 1, size_x)):
            z = diagonal - x
            if z < 0 or z >= size_z:
                continue

            bid = int(blocks_top[z, x])
            inside = is_inside_octagon(
                int(x * 1040 / size_x),
                int(z * 1040 / size_z)
            )

            if not inside:
                # Sea margin
                sx = (x - z) * tw + cx + offset_x
                sy = (x + z) * th + cy + offset_y
                pts = [(sx, sy - th), (sx + tw, sy), (sx, sy + th), (sx - tw, sy)]
                draw.polygon(pts, fill=SEA_COLOR)
                continue

            colors = BLOCK_COLORS.get(bid)
            if colors is None:
                colors = BLOCK_COLORS[1]  # default stone

            top_c, left_c, right_c = colors

            sx = (x - z) * tw + cx + offset_x
            sy = (x + z) * th + cy + offset_y

            # Top face
            top_pts = [(sx, sy - th), (sx + tw, sy), (sx, sy + th), (sx - tw, sy)]
            draw.polygon(top_pts, fill=top_c)

            # Left face
            left_pts = [(sx - tw, sy), (sx, sy + th), (sx, sy + th * 2), (sx - tw, sy + th)]
            draw.polygon(left_pts, fill=left_c)

            # Right face
            right_pts = [(sx + tw, sy), (sx, sy + th), (sx, sy + th * 2), (sx + tw, sy + th)]
            draw.polygon(right_pts, fill=right_c)

    return img


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)