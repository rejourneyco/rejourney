#!/bin/bash

# Get local IP address (works on macOS)
LOCAL_IP=$(ipconfig getifaddr en0)

if [ -z "$LOCAL_IP" ]; then
    echo "❌ Could not determine local IP address from en0. Skipping IP update."
    exit 0
fi

echo "🔄 Updating configuration with local IP: $LOCAL_IP"

# Define files to update
ENV_FILE=".env.local"
BOILERPLATE_FILE="examples/react-native-boilerplate/app/_layout.tsx"
BREW_FILE="examples/brew-coffee-labs/app/_layout.tsx"
BARE_FILE="examples/react-native-bare/App.tsx"

# Function to escape periods for sed
escape_ip() {
    echo "$1" | sed 's/\./\\./g'
}

ESCAPED_IP=$(escape_ip "$LOCAL_IP")

# Update .env.local
if [ -f "$ENV_FILE" ]; then
    echo "Updating $ENV_FILE..."
    # Update S3_PUBLIC_ENDPOINT
    sed -i '' "s/S3_PUBLIC_ENDPOINT=http:\/\/[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:9000/S3_PUBLIC_ENDPOINT=http:\/\/$ESCAPED_IP:9000/" "$ENV_FILE"
    
    # Update PUBLIC_DASHBOARD_URL
    sed -i '' "s/PUBLIC_DASHBOARD_URL=http:\/\/[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:8080/PUBLIC_DASHBOARD_URL=http:\/\/$ESCAPED_IP:8080/" "$ENV_FILE"
    
    # Update PUBLIC_API_URL
    sed -i '' "s/PUBLIC_API_URL=http:\/\/[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:3000/PUBLIC_API_URL=http:\/\/$ESCAPED_IP:3000/" "$ENV_FILE"
    
    # Update PUBLIC_INGEST_URL
    sed -i '' "s/PUBLIC_INGEST_URL=http:\/\/[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:3000/PUBLIC_INGEST_URL=http:\/\/$ESCAPED_IP:3000/" "$ENV_FILE"
    
    # Update DASHBOARD_ORIGIN
    sed -i '' "s/DASHBOARD_ORIGIN=http:\/\/[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:8080/DASHBOARD_ORIGIN=http:\/\/$ESCAPED_IP:8080/" "$ENV_FILE"
    
    # Update OAUTH_REDIRECT_BASE
    sed -i '' "s/OAUTH_REDIRECT_BASE=http:\/\/[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:3000/OAUTH_REDIRECT_BASE=http:\/\/$ESCAPED_IP:3000/" "$ENV_FILE"
fi

# Update Example Apps
# The pattern looks for 'apiUrl: 'http://...:3000''
# We want to replace the IP part.

update_example_app() {
    local file="$1"
    if [ -f "$file" ]; then
        echo "Updating $file..."
        sed -i '' "s/apiUrl: 'http:\/\/[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:3000'/apiUrl: 'http:\/\/$ESCAPED_IP:3000'/" "$file"
    else
        echo "⚠️  File not found: $file"
    fi
}

update_example_app "$BOILERPLATE_FILE"
update_example_app "$BREW_FILE"
update_example_app "$BARE_FILE"

echo "✅ IP addresses updated to $LOCAL_IP"
