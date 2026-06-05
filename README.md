# Webhook.flow: Real-time Webhook Tester (PRO Edition)

Webhook.flow is a premium, real-time HTTP request capture tool designed to test and inspect webhooks locally. It is built as a single Go binary that serves a beautiful, glassmorphic dark-theme frontend and uses Server-Sent Events (SSE) to push incoming requests instantly.

---

## 🚀 How to Run the Server

### Option 1: Run with Go
In the project directory, run:
```bash
go run main.go
```
The server will start on http://localhost:8345.

### Option 2: Run the Compiled Executable
Run the pre-compiled executable on Windows:
```cmd
.\webhook_tester.exe
```
The server will start on http://localhost:8345.

### Option 3: Run with Docker
You can build and run Webhook.flow in a lightweight container:
```bash
# Build the Docker image
docker build -t webhook-flow .

# Run the container mapping your local port 8345
docker run -d -p 8345:8345 --name webhook-tester webhook-flow
```
Open **[http://localhost:8345](http://localhost:8345)** in your web browser.

---

## ☁️ Cloud / Railway Deployment

Webhook.flow is fully optimized for containerized cloud deployment platforms like **Railway**:
- **Dynamic Port Injection**: Reads the dynamic `PORT` environment variable injected by Railway (falling back to `8345` on local runs).
- **Multi-Stage Build**: Utilizes a lightweight alpine runner stage resulting in an image size of only ~20MB.
- **Embedded Frontend**: Builds all static CSS, HTML, and JS assets directly into the binary, removing any asset synchronization issues.

To deploy on Railway:
1. Connect your GitHub repository to Railway.
2. Railway will automatically detect the `Dockerfile` and build/deploy your container.
3. Railway will generate a public domain link (e.g. `https://webhook-flow-production.up.railway.app`) which will dynamically map to the capturer endpoints.

---

## 🎨 Refined Features & Capabilities

Webhook.flow is upgraded with state-of-the-art interfaces and developer tools:

1. **Custom Response Settings (Drawer)**:
   - Click the **Response Settings** button in the header to open a sliding configuration drawer.
   - Define custom HTTP status codes (e.g. `201 Created`, `204 No Content`, `400 Bad Request`, `500 Internal Server Error`).
   - Choose different Content-Types (`text/plain`, `application/json`, `text/html`, `application/xml`).
   - Input mock response body payloads returned when your webhook URL is called.
2. **Captured Requests Sidebar Operations**:
   - Hover over request items to pin/unpin them to the top of your captures feed.
   - Delete specific requests from history using the trash icon.
   - Live filter search box to filter requests instantly by method, ID, or IP.
3. **Advanced Request Inspector Pane**:
   - **Details Cards**: Highlight Method, Capture Time, Client IP, and Content Size.
   - **Headers Tab**: Filterable table of all headers.
   - **Query Parameters Tab**: Tabular layout for url parameters.
   - **Request Body Tab**: Syntax highlights JSON bodies (colorizes keys, strings, numbers, booleans, and null values). Includes a live search text highlighter to find strings in long payloads.
   - **Download Button**: Download individual request bodies as `.json` or `.txt` files directly.
   - **Raw HTTP Tab**: Displays a raw dump of the HTTP request headers and payload as received over the wire.
4. **Slide-in Toast Notifications**:
   - Receive smooth animated toast popups at the bottom-right of your window whenever a new webhook payload is captured or a configuration is successfully saved.
5. **Background Glow Blobs**:
   - Liquid moving gradients Float animation backdrops to make the workspace look alive and modern.

---

## 🧪 Testing Your Webhook

You can send request payloads using various clients. Replace `{token}` with your session token:

### 1. Using cURL (JSON POST)
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Custom-Header: WebhookFlowTest" \
  -d '{"status": "success", "event": "invoice.paid", "amount": 250.00}' \
  http://localhost:8345/w/{token}
```

### 2. Using cURL (GET with Query Params)
```bash
curl -X GET "http://localhost:8345/w/{token}?user_id=99&source=dashboard&verified=true"
```
