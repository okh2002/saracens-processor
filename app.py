import os
import json
import tempfile
import zipfile
import shutil
from io import BytesIO
from datetime import datetime, timedelta
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
import boto3
from PIL import Image
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    import anvil.parser as anvil
    from anvil.region import RegionFile
except ImportError as e:
    logger.error(f"Failed to import anvil-parser: {e}")
    raise ImportError("anvil-parser is required but not installed. Install with: pip install anvil-parser")

app = Flask(__name__)
CORS(app)

# Backblaze B2 configuration
B2_KEY_ID = os.getenv('B2_KEY_ID', '0037b711c53ab060000000002')
B2_APP_KEY = os.getenv('B2_APP_KEY', 'K003gC6T0K2CkzcZu3TutLXyzbn6rvU')
B2_ENDPOINT = os.getenv('B2_ENDPOINT', 's3.eu-central-003.backblazeb2.com')
B2_BUCKET = os.getenv('B2_BUCKET', 'saracens-worlds')

# Initialize B2 client
s3_client = boto3.client(
    's3',
    endpoint_url=B2_ENDPOINT,
    aws_access_key_id=B2_KEY_ID,
    aws_secret_access_key=B2_APP_KEY,
    region_name='us-east-1'  # B2 uses this but it's not actually used
)

# Block colors for rendering
BLOCK_COLORS = {
    2: ((106,127,75), (79,96,56), (91,111,64)),   # grass: top, left, right
    1: ((125,125,125), (100,100,100), (112,112,112)), # stone
    3: ((134,96,67), (107,77,54), (120,86,60)),    # dirt
    12: ((219,207,163), (175,166,130), (197,186,146)), # sand
    9: ((64,147,212), (51,117,169), (57,132,190)), # water
    80: ((255,255,255), (204,204,204), (229,229,229)), # snow
    13: ((136,126,126), (109,101,101), (122,113,113)), # gravel
    7: ((21,21,21), (17,17,17), (19,19,19)),       # bedrock
}

def is_inside_octagon(x, z, cx, cz, size):
    """Check if coordinates are inside an octagon"""
    dx = abs(x - cx)
    dz = abs(z - cz)
    if dx > size or dz > size:
        return False
    return dx + dz <= size * 1.414

def world_to_iso(x, y, z, tile_w=2, tile_h=1):
    """Convert world coordinates to isometric screen coordinates"""
    screen_x = (x - z) * tile_w
    screen_y = (x + z) * tile_h - y * 2
    return screen_x, screen_y

def generate_presigned_url(key, expiration=86400):
    """Generate a presigned URL for B2 download"""
    try:
        return s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': B2_BUCKET, 'Key': key},
            ExpiresIn=expiration
        )
    except Exception as e:
        logger.error(f"Error generating presigned URL: {e}")
        return None

def upload_to_b2(file_data, key):
    """Upload file to Backblaze B2"""
    try:
        s3_client.put_object(
            Bucket=B2_BUCKET,
            Key=key,
            Body=file_data,
            ContentType='application/zip' if key.endswith('.zip') else 'image/png'
        )
        logger.info(f"Successfully uploaded {key} to B2")
    except Exception as e:
        logger.error(f"Error uploading to B2: {e}")
        raise e

@app.route('/generate-world', methods=['POST'])
def generate_world():
    try:
        data = request.get_json()
        heightmap = np.array(data['heightmap'])
        city_id = data['city_id']
        city_name = data['city_name']
        
        # Create temporary directory for world
        temp_dir = tempfile.mkdtemp()
        world_dir = os.path.join(temp_dir, city_name)
        os.makedirs(world_dir)
        
        # Create region directory
        region_dir = os.path.join(world_dir, 'region')
        os.makedirs(region_dir, exist_ok=True)
        
        # World dimensions and center
        world_size = 1040
        center_x, center_z = 520, 520
        land_size = 400
        
        # Create region files (32x32 chunks each)
        region_files = {}
        logger.info(f"Creating region files for world generation...")
        
        try:
            for region_x in range(0, 1040, 512):
                for region_z in range(0, 1040, 512):
                    region_key = f"r.{region_x//512}.{region_z//512}.mca"
                    region_files[region_key] = RegionFile()
        except Exception as e:
            logger.error(f"Error creating region files: {e}")
            return jsonify({"success": False, "error": f"Region file creation failed: {str(e)}"}), 500
        
        # Generate world blocks
        for x in range(world_size):
            for z in range(world_size):
                # Get heightmap value (interpolate if needed)
                hm_x = int(x * 256 / world_size)
                hm_z = int(z * 256 / world_size)
                hm_x = min(hm_x, 255)
                hm_z = min(hm_z, 255)
                elevation = heightmap[hm_z][hm_x]
                
                # Determine region file
                region_x = x // 512
                region_z = z // 512
                region_key = f"r.{region_x}.{region_z}.mca"
                region = region_files[region_key]
                
                # Get chunk coordinates
                chunk_x = x // 16
                chunk_z = z // 16
                
                # Generate blocks based on position and elevation
                is_in_octagon = is_inside_octagon(x, z, center_x, center_z, land_size)
                
                for y in range(256):
                    if y == 0:
                        # Bedrock at bottom
                        block_id = 7
                    elif not is_in_octagon and x < 120 or x >= 920 or z < 120 or z >= 920:
                        # Sea margin - water
                        if y <= 62:
                            block_id = 9  # water
                        elif y == 63:
                            block_id = 12  # sand
                        else:
                            continue  # air
                    elif is_in_octagon:
                        if elevation <= 0.15:
                            # Coastal/sea areas
                            if y <= 62:
                                block_id = 9  # water
                            elif y == 63:
                                block_id = 12  # sand
                            else:
                                continue
                        elif elevation <= 0.25:
                            # Beach
                            if y == 63:
                                block_id = 12  # sand
                            else:
                                continue
                        elif elevation <= 0.5:
                            # Low land
                            ground_level = 60 + int(elevation * 40)
                            if y == ground_level:
                                block_id = 2  # grass
                            elif y > 0 and y < ground_level + 3:
                                block_id = 3  # dirt
                            elif y >= ground_level and y <= ground_level + 3:
                                block_id = 1  # stone
                            else:
                                continue
                        elif elevation <= 0.75:
                            # Hills
                            ground_level = 70 + int(elevation * 30)
                            if y == ground_level:
                                block_id = 2  # grass
                            elif y > 0 and y < ground_level - 1:
                                block_id = 3  # dirt
                            elif y >= ground_level - 1 and y <= ground_level + 2:
                                block_id = 1  # stone
                            else:
                                continue
                        else:
                            # Mountains
                            ground_level = 80 + int(elevation * 20)
                            if y > 90 and y == ground_level:
                                block_id = 80  # snow
                            elif y == ground_level and np.random.random() > 0.7:
                                block_id = 13  # gravel patches
                            elif y == ground_level:
                                block_id = 1  # stone
                            elif y > 0 and y < ground_level:
                                block_id = 1  # stone
                            else:
                                continue
                    else:
                        continue
                    
                    # Set block in region
                    try:
                        chunk = region.get_chunk(chunk_x, chunk_z)
                        chunk.set_block(x % 16, y, z % 16, block_id)
                    except Exception as e:
                        logger.warning(f"Failed to set block at ({x}, {y}, {z}): {e}")
                        continue
        
        # Save region files
        logger.info(f"Saving {len(region_files)} region files...")
        try:
            for region_key, region in region_files.items():
                region_path = os.path.join(region_dir, region_key)
                with open(region_path, 'wb') as f:
                    region.write(f)
            logger.info(f"Region files saved successfully")
        except Exception as e:
            logger.error(f"Error saving region files: {e}")
            return jsonify({"success": False, "error": f"Region file save failed: {str(e)}"}), 500
        
        # Create level.dat (basic world data)
        level_data = {
            'Data': {
                'LevelName': city_name,
                'SpawnX': center_x,
                'SpawnY': 64,
                'SpawnZ': center_z,
                'GameType': 0,
                'Difficulty': 1,
                'allowCheats': False
            }
        }
        
        # Save level.dat
        try:
            import anvil.nbt as nbt
            root_tag = nbt.Compound('Data')
            for key, value in level_data['Data'].items():
                if isinstance(value, str):
                    root_tag[key] = nbt.String(key, value)
                elif isinstance(value, int):
                    root_tag[key] = nbt.Int(key, value)
                elif isinstance(value, bool):
                    root_tag[key] = nbt.Byte(key, 1 if value else 0)
            
            level_path = os.path.join(world_dir, 'level.dat')
            with open(level_path, 'wb') as f:
                nbt.write(root_tag, f)
        except Exception as e:
            logger.error(f"Error creating level.dat: {e}")
            return jsonify({"success": False, "error": f"Level.dat creation failed: {str(e)}"}), 500
        
        # Zip the world
        try:
            zip_buffer = BytesIO()
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                for root, dirs, files in os.walk(world_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        arc_path = os.path.relpath(file_path, temp_dir)
                        zip_file.write(file_path, arc_path)
            logger.info(f"World zip created: {len(zip_buffer.getvalue())} bytes")
        except Exception as e:
            logger.error(f"Error creating world zip: {e}")
            return jsonify({"success": False, "error": f"World zip creation failed: {str(e)}"}), 500
        
        zip_buffer.seek(0)
        
        # Upload to B2
        try:
            world_key = f"worlds/{city_id}/world.zip"
            upload_to_b2(zip_buffer.getvalue(), world_key)
            logger.info(f"World uploaded successfully to {world_key}")
        except Exception as e:
            logger.error(f"Error uploading world: {e}")
            return jsonify({"success": False, "error": f"World upload failed: {str(e)}"}), 500
        
        # Generate presigned URL
        try:
            download_url = generate_presigned_url(world_key)
            if download_url:
                return jsonify({
                    "success": True,
                    "download_url": download_url,
                    "city_id": city_id
                })
            else:
                return jsonify({"success": False, "error": "Failed to generate download URL"}), 500
        except Exception as e:
            logger.error(f"Error in generate_world: {e}")
            return jsonify({"success": False, "error": f"World generation failed: {str(e)}"}), 500

@app.route('/generate-render', methods=['POST'])
def generate_render():
    try:
        data = request.get_json()
        city_id = data['city_id']
        schematic_key = data['schematic_key']
        
        # Download schematic from B2
        try:
            response = s3_client.get_object(Bucket=B2_BUCKET, Key=schematic_key)
            schematic_data = response['Body'].read()
            schematic = np.load(BytesIO(schematic_data))
            logger.info(f"Schematic loaded: {schematic_key}")
        except Exception as e:
            logger.error(f"Error downloading schematic: {e}")
            return jsonify({"success": False, "error": f"Schematic download failed: {str(e)}"}), 500
        
        # Generate isometric render
        render_image = generate_isometric_render(schematic)
        
        # Upload render to B2
        render_buffer = BytesIO()
        render_image.save(render_buffer, format='PNG')
        render_buffer.seek(0)
        
        render_key = f"renders/{city_id}/render.png"
        upload_to_b2(render_buffer.getvalue(), render_key)
        
        # Generate presigned URL
        render_url = generate_presigned_url(render_key)
        
        return jsonify({
            "success": True,
            "render_url": render_url,
            "city_id": city_id
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/process-world-upload', methods=['POST'])
def process_world_upload():
    try:
        if 'world_zip' not in request.files:
            return jsonify({"success": False, "error": "Missing world_zip file"}), 400
        
        world_zip = request.files['world_zip']
        city_id = request.form.get('city_id')
        
        if not city_id:
            return jsonify({"success": False, "error": "Missing city_id"}), 400
        
        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        
        try:
            # Save and extract uploaded zip
            zip_path = os.path.join(temp_dir, 'uploaded_world.zip')
            world_zip.save(zip_path)
            
            world_dir = os.path.join(temp_dir, 'world')
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(world_dir)
            
            # Extract 1040x1040 block area centered at (520, 520)
            schematic = extract_world_area(world_dir)
            
            # Save schematic as numpy array
            schematic_buffer = BytesIO()
            np.save(schematic_buffer, schematic)
            schematic_buffer.seek(0)
            
            # Upload schematic to B2
            schematic_key = f"schematics/{city_id}/schematic.npy"
            upload_to_b2(schematic_buffer.getvalue(), schematic_key)
            logger.info(f"Schematic uploaded to {schematic_key}")
            
            # Internal call to generate-render endpoint
            render_data = {
                'city_id': city_id,
                'schematic_key': schematic_key
            }
            
            with app.test_request_context('/generate-render', json=render_data, method='POST') as ctx:
                render_response = generate_render()
                render_result = render_response.get_json()
            
            # Cleanup
            shutil.rmtree(temp_dir)
            
            return jsonify({
                "success": True,
                "schematic_key": schematic_key,
                "render_url": render_result.get('render_url'),
                "city_id": city_id
            })
        except Exception as e:
            logger.error(f"Error processing world upload: {e}")
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
            return jsonify({"success": False, "error": f"World upload failed: {str(e)}"}), 500

def extract_world_area(world_dir):
    """Extract 1040x1040 block area from world"""
    # Initialize schematic array (x, y, z)
    schematic = np.zeros((1040, 256, 1040), dtype=np.uint8)
    
    # Find region files
    region_dir = os.path.join(world_dir, 'region')
    if not os.path.exists(region_dir):
        raise Exception("No region directory found in world")
    
    # Process each region file
    for region_file in os.listdir(region_dir):
        if region_file.endswith('.mca'):
            region_path = os.path.join(region_dir, region_file)
            region = RegionFile(region_path)
            
            # Extract region coordinates from filename
            parts = region_file.split('.')[1:3]
            region_x, region_z = int(parts[0]), int(parts[1])
            
            # Process chunks in this region
            for chunk_x in range(32):
                for chunk_z in range(32):
                    try:
                        chunk = region.get_chunk(chunk_x, chunk_z)
                        
                        # Convert chunk coordinates to world coordinates
                        world_chunk_x = region_x * 32 + chunk_x
                        world_chunk_z = region_z * 32 + chunk_z
                        
                        # Check if this chunk is within our 1040x1040 area
                        if 0 <= world_chunk_x * 16 < 1040 and 0 <= world_chunk_z * 16 < 1040:
                            # Extract blocks from chunk
                            for x in range(16):
                                for y in range(256):
                                    for z in range(16):
                                        world_x = world_chunk_x * 16 + x
                                        world_z = world_chunk_z * 16 + z
                                        
                                        if 0 <= world_x < 1040 and 0 <= world_z < 1040:
                                            block_id = chunk.get_block(x, y, z)
                                            schematic[world_x, y, world_z] = block_id
                    except:
                        continue  # Skip chunks that can't be loaded
    
    return schematic

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 5000)), debug=True)
