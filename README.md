# Sokuji React

A simultaneous interpretation application built with Electron 34 and React, using OpenAI's Realtime API.

## Features

- Real-time speech translation using OpenAI's Realtime API
- Support for GPT-4o Realtime and GPT-4o mini Realtime models
- Modern React-based UI

## Development Setup

### Prerequisites

- Node.js (latest LTS version recommended)
- npm

### Installation

1. Clone the repository
   ```
   git clone https://github.com/yourusername/sokuji-react.git
   cd sokuji-react
   ```

2. Install dependencies
   ```
   npm install
   ```

3. Create a `.env` file in the root directory and add your OpenAI API key:
   ```
   OPENAI_API_KEY=your_api_key_here
   ```

### Running the Application

#### Development Mode

Start the application in development mode:

```
npm run electron:dev
```

This will start both the React development server and Electron.

#### Production Build

Build the application for production:

```
npm run electron:build
```

## Technologies Used

- Electron 34
- React 18
- TypeScript
- OpenAI Realtime API
- Leaflet for mapping
- SASS for styling

## License

[MIT](LICENSE)
