#!/usr/bin/env node

/**
 * Test script for WebSocket connection and disconnection
 * Tests the experimental-relay endpoint
 */

const WebSocket = require('ws');

async function testWebSocketRelay() {
  console.log('Testing WebSocket relay connection and disconnection...');
  
  // Replace with your actual endpoint
  const wsUrl = 'ws://localhost:8787/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
  
  try {
    console.log('Connecting to:', wsUrl);
    const ws = new WebSocket(wsUrl, {
      headers: {
        'Sec-WebSocket-Protocol': 'realtime'
      }
    });

    ws.on('open', () => {
      console.log('✅ WebSocket connected successfully');
      
      // Send a test message
      const testMessage = {
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          voice: 'alloy'
        }
      };
      
      console.log('Sending test message:', testMessage);
      ws.send(JSON.stringify(testMessage));
      
      // Close connection after 2 seconds
      setTimeout(() => {
        console.log('Closing WebSocket connection...');
        ws.close(1000, 'Test completed');
      }, 2000);
    });

    ws.on('message', (data) => {
      console.log('Received message:', data.toString());
    });

    ws.on('close', (code, reason) => {
      console.log(`✅ WebSocket closed with code ${code}: ${reason}`);
      console.log('Test completed successfully!');
      process.exit(0);
    });

    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
      process.exit(1);
    });

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testWebSocketRelay();