# File Ingestion Guide

Open Brain now supports file ingestion for automatic text extraction and storage in your memory system.

## Supported File Types

### Text Files
- `.txt` - Plain text files
- `.md` - Markdown files

### Document Files
- `.pdf` - PDF documents
- `.docx` - Microsoft Word documents

### Image Files (OCR)
- `.jpg` / `.jpeg` - JPEG images
- `.png` - PNG images
- `.gif` - GIF images
- `.bmp` - Bitmap images
- `.webp` - WebP images

## How It Works

### Text Files
Text files are read directly and their content is stored as a thought.

### Document Files
- **PDF files**: Extracted using `pdf-parse` library
- **Word documents**: Extracted using `mammoth` library

### Image Files (OCR)
Images are processed using **z.ai GLM-OCR API**, a state-of-the-art OCR model that:
- Extracts text from images with high accuracy
- Handles complex layouts, tables, and formulas
- Recognizes handwriting
- Works with mixed text-image content

## Setup Requirements

### 1. Get z.ai API Key (for Image OCR)

1. Visit [z.ai](https://z.ai) and sign up for an account
2. Navigate to API settings
3. Generate an API key
4. Add the key to your `.env` file:

```bash
ZAI_API_KEY=your_actual_zai_api_key_here
```

### 2. Restart Services

```bash
docker compose restart capture-api telegram-bot
```

### 3. Verify Setup

Check that OCR is enabled:

```bash
docker logs openbrain-capture-api | grep GLM-OCR
```

You should see:
- `Z.ai GLM-OCR integration enabled` (if key is set)
- `Z.ai GLM-OCR integration disabled - ZAI_API_KEY not set` (if key is missing)

## Usage

### Via Telegram Bot

Simply send any supported file to your Telegram bot (@openBrain_xix_bot):

1. **Open Telegram** and search for your bot
2. **Send a file** - attach any document or image
3. **Wait for processing** - the bot will confirm when done
4. **Search your memory** - use `/search` to find extracted content

**Example commands:**
```
/send [attach a PDF file]
/search "content from PDF"
/recent
```

### Via API

Use the `/upload` endpoint:

```bash
curl -X POST http://localhost:8888/upload \
  -H "X-OpenBrain-Key: your_openbrain_api_key" \
  -F "file=@/path/to/your/file.pdf"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "content": "Extracted text content...",
    "full_content_length": 1234,
    "metadata": {
      "source": "file_upload",
      "filename": "document.pdf",
      "file_type": ".pdf",
      "file_size": 123456,
      "mimetype": "application/pdf"
    },
    "original_filename": "document.pdf",
    "file_type": ".pdf",
    "file_size": 123456,
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

## Database Schema

File metadata is stored in the `thoughts` table:

```sql
-- New columns added for file ingestion
original_filename TEXT  -- Original filename
file_type TEXT         -- File extension (.pdf, .jpg, etc.)
file_size BIGINT       -- File size in bytes
```

## Migration

For existing installations, run the migration script:

```bash
docker exec openbrain-db psql -U postgres -d openbrain -f /dev/stdin < migrate.sql
```

## Limitations

- **File size**: Maximum 10MB per file
- **OCR timeout**: 30 seconds per image
- **Supported formats**: See [Supported File Types](#supported-file-types) above

## Troubleshooting

### OCR Not Working

**Problem**: Images are not processed

**Solution**:
1. Check ZAI_API_KEY is set in `.env`
2. Verify API key is valid at z.ai
3. Check capture-api logs: `docker logs openbrain-capture-api`

### File Upload Fails

**Problem**: "Failed to extract text from file"

**Solution**:
1. Check file is supported format
2. Verify file is not corrupted
3. Check file size is under 10MB
4. Check capture-api logs for details

### Telegram Bot Not Receiving Files

**Problem**: Bot doesn't respond to file uploads

**Solution**:
1. Check bot is running: `docker ps | grep telegram-bot`
2. Check bot logs: `docker logs openbrain-telegram-bot`
3. Verify CAPTURE_API_URL is correct
4. Restart bot: `docker compose restart telegram-bot`

## Examples

### Capture a PDF via Telegram
1. Open Telegram
2. Find @openBrain_xix_bot
3. Attach a PDF file
4. Wait for confirmation message
5. Search content with `/search "your query"`

### Capture an Image via API
```bash
# Upload image for OCR
curl -X POST http://localhost:8888/upload \
  -H "X-OpenBrain-Key: your_openbrain_api_key" \
  -F "file=@screenshot.png"

# Search extracted text
curl -X POST http://localhost:8888/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "semantic_search",
      "arguments": {"query": "text from screenshot"}
    }
  }'
```

## Security Notes

- All file uploads require valid `OPENBRAIN_API_KEY`
- Files are processed in memory (not stored permanently)
- Original files are not saved, only extracted text
- OCR API calls are made directly to z.ai (files are not stored)

## API Endpoints

### POST /upload
Upload and process a file.

**Headers:**
- `X-OpenBrain-Key`: Your API key
- `Content-Type`: `multipart/form-data`

**Body:**
- `file`: The file to process (multipart)

**Response:**
- JSON with extracted text and metadata

### POST /capture (existing)
Capture text directly (unchanged).

## Features

✅ **Automatic text extraction** from documents
✅ **OCR for images** using state-of-the-art GLM-OCR
✅ **Semantic search** over extracted content
✅ **Telegram integration** for easy file uploads
✅ **Metadata tracking** (filename, type, size)
✅ **Error handling** for unsupported formats

## Future Enhancements

Potential additions:
- Support for more file types (.xlsx, .pptx)
- Batch file upload
- File preview in search results
- Direct file editing and re-processing
