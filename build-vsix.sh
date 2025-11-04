#!/bin/bash

set -e

echo "Building simple-chat-extension VSIX package..."
echo ""

# Install dependencies
echo "Installing dependencies..."
npm install

# Compile TypeScript
echo "Compiling TypeScript..."
npm run compile

# Check if vsce is installed, if not install it globally
if ! command -v vsce &> /dev/null; then
    echo "vsce not found, installing @vscode/vsce globally..."
    npm install -g @vscode/vsce
fi

# Package the extension
echo "Packaging extension..."
vsce package

echo ""
echo "Build complete! VSIX file created."
