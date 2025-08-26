#!/bin/bash

# Deploy script for Wallet Model
# This script helps deploy the new wallet-based backend

set -e

echo "🚀 Deploying Wallet Model Backend..."

# Colors for output
RED='\033[0;31m'


GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ wrangler CLI is not installed${NC}"
    echo "Please install wrangler: npm install -g wrangler"
    exit 1
fi

# Function to prompt for confirmation
confirm() {
    read -p "$1 (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}⚠️  Deployment cancelled${NC}"
        exit 1
    fi
}

echo -e "${YELLOW}📋 Pre-deployment Checklist:${NC}"
echo "1. Have you backed up your current database? (Recommended)"
echo "2. Are you ready to deploy the wallet model (tokens never expire)?"
echo "3. Have you reviewed the wallet-schema.sql file?"
echo ""

confirm "Do you want to continue?"

## Step 1: Apply database schema
#echo -e "\n${GREEN}📊 Step 1: Applying database schema...${NC}"
#if [ -f "schema/wallet-schema.sql" ]; then
#    echo "Applying wallet schema to D1 database..."
#
#    # Get database name from wrangler.toml
#    DB_NAME=$(grep -A1 "\[\[d1_databases\]\]" wrangler.toml | grep "database_name" | cut -d'"' -f2)
#
#    if [ -z "$DB_NAME" ]; then
#        echo -e "${RED}❌ Could not find database name in wrangler.toml${NC}"
#        exit 1
#    fi
#
#    echo "Database: $DB_NAME"
#    confirm "Apply wallet-schema.sql to $DB_NAME?"
#
#    wrangler d1 execute "$DB_NAME" --file=schema/wallet-schema.sql
#    echo -e "${GREEN}✅ Database schema applied${NC}"
#else
#    echo -e "${RED}❌ wallet-schema.sql not found${NC}"
#    exit 1
#fi

# Step 2: Update index.ts to use wallet model
echo -e "\n${GREEN}🔧 Step 2: Switching to wallet model...${NC}"
if [ -f "src/index-wallet.ts" ]; then
    # Backup current index.ts
    if [ -f "src/index.ts" ]; then
        cp src/index.ts src/index-backup.ts
        echo "Backed up current index.ts to index-backup.ts"
    fi
    
    # Replace with wallet version
    cp src/index-wallet.ts src/index.ts
    echo -e "${GREEN}✅ Switched to wallet model index${NC}"
else
    echo -e "${RED}❌ index-wallet.ts not found${NC}"
    exit 1
fi

# Step 3: Build the worker
echo -e "\n${GREEN}🔨 Step 3: Building worker...${NC}"
npm run build 2>/dev/null || true  # Build if build script exists

# Step 4: Deploy to Cloudflare
echo -e "\n${GREEN}☁️  Step 4: Deploying to Cloudflare...${NC}"
echo "Choose deployment environment:"
echo "1) Development (wrangler.dev.toml)"
echo "2) Production (wrangler.toml)"
read -p "Enter choice (1 or 2): " ENV_CHOICE

if [ "$ENV_CHOICE" = "1" ]; then
    echo "Deploying to development..."
    wrangler deploy --config wrangler.dev.toml
elif [ "$ENV_CHOICE" = "2" ]; then
    echo -e "${YELLOW}⚠️  WARNING: Deploying to PRODUCTION${NC}"
    confirm "Are you sure you want to deploy to production?"
    wrangler deploy
else
    echo -e "${RED}❌ Invalid choice${NC}"
    exit 1
fi

# Step 5: Verify deployment
echo -e "\n${GREEN}🔍 Step 5: Verifying deployment...${NC}"
if [ "$ENV_CHOICE" = "1" ]; then
    WORKER_URL=$(wrangler whoami 2>/dev/null | grep -oP 'https://[^"]+\.workers\.dev' | head -1 || echo "https://your-worker.workers.dev")
else
    WORKER_URL="https://api.sokuji.kizuna.ai"
fi

echo "Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s "$WORKER_URL/" || echo "{}")
if echo "$HEALTH_RESPONSE" | grep -q "wallet"; then
    echo -e "${GREEN}✅ Wallet model deployed successfully!${NC}"
    echo "Response: $HEALTH_RESPONSE"
else
    echo -e "${YELLOW}⚠️  Could not verify deployment. Please check manually.${NC}"
fi

# Step 6: Post-deployment instructions
echo -e "\n${GREEN}📝 Post-Deployment Notes:${NC}"
echo "1. The wallet model is now active"
echo "2. Tokens are minted only on successful payments"
echo "3. Tokens never expire (no monthly reset)"
echo "4. Test webhook processing with a payment event"
echo ""
echo "Webhook URL: $WORKER_URL/api/auth/webhook/clerk"
echo ""
echo -e "${GREEN}🎉 Deployment complete!${NC}"

# Optional: Show recent logs
echo ""
read -p "Do you want to view recent logs? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    wrangler tail
fi