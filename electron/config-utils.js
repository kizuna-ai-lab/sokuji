const fs = require('fs');
const path = require('path');
const os = require('os');
const TOML = require('@iarna/toml');

// Define the config directory and file path
const CONFIG_DIR = path.join(os.homedir(), '.config', 'sokuji');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.toml');

// Default configuration
const DEFAULT_CONFIG = {};

/**
 * Ensures the configuration directory exists
 */
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Creates a default configuration file if it doesn't exist
 */
function createDefaultConfig() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, TOML.stringify(DEFAULT_CONFIG));
  }
}

/**
 * Reads the configuration from the file
 * @returns {Object} The configuration object
 */
function readConfig() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    createDefaultConfig();
  }
  
  try {
    const configData = fs.readFileSync(CONFIG_FILE, 'utf8');
    return TOML.parse(configData);
  } catch (error) {
    console.error('[Sokuji] [Config] Error reading config file:', error);
    // If there's an error reading the file, create a new default config
    createDefaultConfig();
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Writes the configuration to the file
 * @param {Object} config - The configuration object to write
 */
function writeConfig(config) {
  ensureConfigDir();
  try {
    fs.writeFileSync(CONFIG_FILE, TOML.stringify(config));
    return true;
  } catch (error) {
    console.error('[Sokuji] [Config] Error writing config file:', error);
    return false;
  }
}

/**
 * Gets a specific configuration value
 * @param {string} key - The key to get (using dot notation, e.g., 'settings.apiKey')
 * @param {any} defaultValue - The default value to return if the key doesn't exist
 * @returns {any} The configuration value
 */
function getConfig(key, defaultValue = null) {
  const config = readConfig();
  
  // Handle dot notation (e.g., 'settings.apiKey')
  const keys = key.split('.');
  let value = config;
  
  for (const k of keys) {
    if (value === undefined || value === null || typeof value !== 'object') {
      return defaultValue;
    }
    value = value[k];
  }
  
  return value !== undefined ? value : defaultValue;
}

/**
 * Sets a specific configuration value
 * @param {string} key - The key to set (using dot notation, e.g., 'settings.apiKey')
 * @param {any} value - The value to set
 * @returns {boolean} Whether the operation was successful
 */
function setConfig(key, value) {
  const config = readConfig();
  
  // Handle dot notation (e.g., 'settings.apiKey')
  const keys = key.split('.');
  let current = config;
  
  // Navigate to the nested object
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!current[k] || typeof current[k] !== 'object') {
      current[k] = {};
    }
    current = current[k];
  }
  
  // Set the value
  current[keys[keys.length - 1]] = value;
  
  return writeConfig(config);
}

module.exports = {
  readConfig,
  writeConfig,
  getConfig,
  setConfig,
  CONFIG_DIR,
  CONFIG_FILE,
  createDefaultConfig
};
