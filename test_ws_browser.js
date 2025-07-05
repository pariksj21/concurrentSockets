// Browser-compatible WebSocket test
// This can be run in browser console or with a browser automation tool

function testWebSocketConnection() {
    console.log("Testing WebSocket connection through Traefik...");
    
    // Test connection through Traefik (port 80)
    const wsUrl = "ws://localhost/ws/chat/test123";
    console.log("Connecting to:", wsUrl);
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = function() {
        console.log("✅ Connected to WebSocket server through Traefik!");
        ws.send("Hello from browser test!");
    };
    
    ws.onmessage = function(event) {
        console.log("📨 Received message:", event.data);
        try {
            const data = JSON.parse(event.data);
            console.log("📊 Parsed data:", data);
        } catch (e) {
            console.log("📄 Raw message:", event.data);
        }
    };
    
    ws.onerror = function(error) {
        console.error("❌ WebSocket error:", error);
    };
    
    ws.onclose = function(event) {
        console.log("🔌 WebSocket connection closed");
        console.log("Close code:", event.code);
        console.log("Close reason:", event.reason);
    };
    
    // Close connection after 5 seconds
    setTimeout(() => {
        console.log("Closing connection...");
        ws.close();
    }, 5000);
    
    return ws;
}

// Test direct connection (bypassing Traefik)
function testDirectConnection() {
    console.log("Testing direct WebSocket connection...");
    
    // Direct connection to the container (won't work from outside Docker network)
    const wsUrl = "ws://localhost:3001/ws/chat/test456";
    console.log("Connecting to:", wsUrl);
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = function() {
        console.log("✅ Connected to WebSocket server directly!");
        ws.send("Hello from direct test!");
    };
    
    ws.onmessage = function(event) {
        console.log("📨 Direct received message:", event.data);
    };
    
    ws.onerror = function(error) {
        console.error("❌ Direct WebSocket error:", error);
    };
    
    ws.onclose = function(event) {
        console.log("🔌 Direct WebSocket connection closed");
    };
    
    setTimeout(() => {
        console.log("Closing direct connection...");
        ws.close();
    }, 5000);
    
    return ws;
}

// Run tests
console.log("🧪 Starting WebSocket tests...");
testWebSocketConnection();

// Wait a bit then test direct connection
setTimeout(() => {
    testDirectConnection();
}, 6000); 