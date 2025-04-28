// Content script for Sokuji browser extension
// This script injects UI elements and handles audio processing in web pages

/* global chrome */

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'TOGGLE_SOKUJI_UI') {
    toggleSokujiUI();
    sendResponse({ success: true });
  }
  return true;
});

// Flag to track if the Sokuji UI is currently shown
let isSokujiUIShown = false;
let sokujiContainer = null;

// Function to toggle the Sokuji UI
function toggleSokujiUI() {
  if (isSokujiUIShown) {
    // Hide the UI
    if (sokujiContainer) {
      document.body.removeChild(sokujiContainer);
      sokujiContainer = null;
    }
    isSokujiUIShown = false;
  } else {
    // Show the UI
    createSokujiUI();
    isSokujiUIShown = true;
  }
}

// Function to create and inject the Sokuji UI
function createSokujiUI() {
  // Create container
  sokujiContainer = document.createElement('div');
  sokujiContainer.id = 'sokuji-container';
  sokujiContainer.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 500px;
    height: 600px;
    background-color: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 9999;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    resize: both;
    min-width: 400px;
    min-height: 500px;
    max-width: 800px;
    max-height: 800px;
  `;
  
  // Create header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 15px;
    background-color: #f5f5f5;
    border-bottom: 1px solid #e0e0e0;
    cursor: move;
  `;
  
  // Add title
  const title = document.createElement('div');
  title.textContent = 'Sokuji Interpreter';
  title.style.fontWeight = 'bold';
  
  // Add close button
  const closeButton = document.createElement('button');
  closeButton.textContent = '✕';
  closeButton.style.cssText = `
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
  `;
  closeButton.onclick = toggleSokujiUI;
  
  // Add elements to header
  header.appendChild(title);
  header.appendChild(closeButton);
  
  // Create iframe to load the popup UI
  const iframe = document.createElement('iframe');
  iframe.style.cssText = `
    flex: 1;
    width: 100%;
    border: none;
  `;
  iframe.src = chrome.runtime.getURL('popup/index.html');
  
  // Add elements to container
  sokujiContainer.appendChild(header);
  sokujiContainer.appendChild(iframe);
  
  // Add container to page
  document.body.appendChild(sokujiContainer);
  
  // Make the container draggable and resizable
  makeDraggable(sokujiContainer, header);
}

// Function to make an element draggable
function makeDraggable(element, dragHandle) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  
  dragHandle.onmousedown = dragMouseDown;
  
  function dragMouseDown(e) {
    e.preventDefault();
    // Get the mouse cursor position at startup
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    // Call a function whenever the cursor moves
    document.onmousemove = elementDrag;
  }
  
  function elementDrag(e) {
    e.preventDefault();
    // Calculate the new cursor position
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    // Set the element's new position
    element.style.top = (element.offsetTop - pos2) + "px";
    element.style.left = (element.offsetLeft - pos1) + "px";
  }
  
  function closeDragElement() {
    // Stop moving when mouse button is released
    document.onmouseup = null;
    document.onmousemove = null;
  }
}
