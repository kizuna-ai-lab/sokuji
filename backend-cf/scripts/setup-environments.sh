#!/bin/bash

# Sokuji Multi-Environment Setup Script
# This script helps set up development and production environments on Cloudflare

set -e

echo "🚀 Sokuji Backend Multi-Environment Setup"
echo "========================================="
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to prompt for input
prompt_input() {
    local var_name=$1
    local prompt_text=$2
    local default_value=$3
    
    if [ -n "$default_value" ]; then
        read -p "$prompt_text [$default_value]: " input_value
        input_value=${input_value:-$default_value}
    else
        read -p "$prompt_text: " input_value
    fi
    
    eval "$var_name='$input_value'"
}

# Function to create resources
create_resources() {
    local env=$1
    local suffix=$2
    
    echo -e "\n${YELLOW}Creating $env resources...${NC}"
    
    # Create D1 Database
    echo "Creating D1 database: sokuji-db-$suffix"
    wrangler d1 create "sokuji-db-$suffix" 2>/dev/null || echo "Database may already exist"
    
    # Create KV Namespaces
    echo "Creating KV namespace: QUOTA_KV_$suffix"
    if [ "$env" = "development" ]; then
        wrangler kv namespace create "QUOTA_KV" --config wrangler.dev.toml 2>/dev/null || echo "KV namespace may already exist"
        wrangler kv namespace create "SESSION_KV" --config wrangler.dev.toml 2>/dev/null || echo "KV namespace may already exist"
    else
        wrangler kv namespace create "QUOTA_KV" 2>/dev/null || echo "KV namespace may already exist"
        wrangler kv namespace create "SESSION_KV" 2>/dev/null || echo "KV namespace may already exist"
    fi
    
    echo -e "${GREEN}✓ $env resources created${NC}"
}

# Function to initialize database
init_database() {
    local env=$1
    local db_name=$2
    
    echo -e "\n${YELLOW}Initializing $env database...${NC}"
    
    if [ "$env" = "development" ]; then
        wrangler d1 execute "$db_name" --file=./schema/database.sql --config wrangler.dev.toml
    else
        wrangler d1 execute "$db_name" --file=./schema/database.sql
    fi
    
    echo -e "${GREEN}✓ Database initialized${NC}"
}

# Function to create AI Gateway
create_ai_gateway() {
    local env=$1
    local suffix=$2
    
    echo -e "\n${YELLOW}Setting up AI Gateway for $env...${NC}"
    echo "AI Gateways must be created manually in the Cloudflare dashboard."
    echo ""
    echo "Steps to create AI Gateway:"
    echo "  1. Go to https://dash.cloudflare.com/ai-gateway"
    echo "  2. Click 'Create Gateway'"
    echo "  3. Name it: sokuji-gateway-$suffix"
    echo "  4. Configure rate limiting and caching as needed"
    echo "  5. Note the Gateway ID for configuration"
    echo ""
    
    prompt_input gateway_id "Enter the AI Gateway ID for $env (or press Enter to skip)" ""
    
    if [ -n "$gateway_id" ]; then
        echo -e "${GREEN}✓ AI Gateway ID noted: $gateway_id${NC}"
        echo "Remember to update wrangler.toml with this Gateway ID"
    else
        echo -e "${YELLOW}⚠ AI Gateway setup skipped. Remember to configure it later.${NC}"
    fi
    
    # Return the gateway ID for later use
    eval "ai_gateway_${suffix}='$gateway_id'"
}

# Function to set secrets
set_secrets() {
    local env=$1
    
    echo -e "\n${YELLOW}Setting $env secrets...${NC}"
    echo "Please enter the following secrets for $env environment:"
    
    prompt_input clerk_secret "Clerk Secret Key" ""
    prompt_input clerk_publishable "Clerk Publishable Key" ""
    prompt_input clerk_webhook "Clerk Webhook Secret" ""
    
    # Optional: AI provider keys
    echo -e "\n${YELLOW}Optional: AI Provider Keys (press Enter to skip)${NC}"
    prompt_input openai_key "OpenAI API Key" ""
    prompt_input gemini_key "Gemini API Key" ""
    prompt_input comet_key "Comet API Key" ""
    prompt_input palabra_key "Palabra API Key" ""
    
    if [ "$env" = "development" ]; then
        echo "$clerk_secret" | wrangler secret put CLERK_SECRET_KEY --config wrangler.dev.toml
        echo "$clerk_publishable" | wrangler secret put CLERK_PUBLISHABLE_KEY --config wrangler.dev.toml
        echo "$clerk_webhook" | wrangler secret put CLERK_WEBHOOK_SECRET --config wrangler.dev.toml
        
        # Set optional AI keys if provided
        [ -n "$openai_key" ] && echo "$openai_key" | wrangler secret put OPENAI_API_KEY --config wrangler.dev.toml
        [ -n "$gemini_key" ] && echo "$gemini_key" | wrangler secret put GEMINI_API_KEY --config wrangler.dev.toml
        [ -n "$comet_key" ] && echo "$comet_key" | wrangler secret put COMET_API_KEY --config wrangler.dev.toml
        [ -n "$palabra_key" ] && echo "$palabra_key" | wrangler secret put PALABRA_API_KEY --config wrangler.dev.toml
    else
        echo "$clerk_secret" | wrangler secret put CLERK_SECRET_KEY
        echo "$clerk_publishable" | wrangler secret put CLERK_PUBLISHABLE_KEY
        echo "$clerk_webhook" | wrangler secret put CLERK_WEBHOOK_SECRET
        
        # Set optional AI keys if provided
        [ -n "$openai_key" ] && echo "$openai_key" | wrangler secret put OPENAI_API_KEY
        [ -n "$gemini_key" ] && echo "$gemini_key" | wrangler secret put GEMINI_API_KEY
        [ -n "$comet_key" ] && echo "$comet_key" | wrangler secret put COMET_API_KEY
        [ -n "$palabra_key" ] && echo "$palabra_key" | wrangler secret put PALABRA_API_KEY
    fi
    
    echo -e "${GREEN}✓ Secrets configured${NC}"
}

# Main setup flow
echo "This script will help you set up development and production environments."
echo "Make sure you have:"
echo "  1. Cloudflare account with Workers enabled"
echo "  2. Wrangler CLI installed and authenticated"
echo "  3. Clerk account with two applications (dev and prod)"
echo "  4. Cloudflare AI Gateway access (optional)"
echo ""

prompt_input setup_dev "Set up development environment? (y/n)" "y"
prompt_input setup_prod "Set up production environment? (y/n)" "y"

# Development setup
if [ "$setup_dev" = "y" ]; then
    echo -e "\n${YELLOW}=== DEVELOPMENT ENVIRONMENT SETUP ===${NC}"
    
    # Create resources
    create_resources "development" "dev"
    
    # Set up AI Gateway
    prompt_input setup_ai_gateway "Set up AI Gateway for development? (y/n)" "y"
    if [ "$setup_ai_gateway" = "y" ]; then
        create_ai_gateway "development" "dev"
    fi
    
    # Initialize database
    prompt_input init_dev_db "Initialize development database? (y/n)" "y"
    if [ "$init_dev_db" = "y" ]; then
        init_database "development" "sokuji-db-dev"
    fi
    
    # Set secrets
    prompt_input set_dev_secrets "Configure development secrets? (y/n)" "y"
    if [ "$set_dev_secrets" = "y" ]; then
        set_secrets "development"
    fi
    
    echo -e "\n${GREEN}✅ Development environment setup complete!${NC}"
    echo "Next steps:"
    echo "  1. Update wrangler.dev.toml with the resource IDs shown above"
    echo "  2. Update .env.development with your Clerk publishable key"
    echo "  3. Deploy with: npm run deploy:dev"
fi

# Production setup
if [ "$setup_prod" = "y" ]; then
    echo -e "\n${YELLOW}=== PRODUCTION ENVIRONMENT SETUP ===${NC}"
    
    # Create resources
    create_resources "production" "prod"
    
    # Set up AI Gateway
    prompt_input setup_ai_gateway "Set up AI Gateway for production? (y/n)" "y"
    if [ "$setup_ai_gateway" = "y" ]; then
        create_ai_gateway "production" "prod"
    fi
    
    # Initialize database
    prompt_input init_prod_db "Initialize production database? (y/n)" "y"
    if [ "$init_prod_db" = "y" ]; then
        init_database "production" "sokuji-db-prod"
    fi
    
    # Set secrets
    prompt_input set_prod_secrets "Configure production secrets? (y/n)" "y"
    if [ "$set_prod_secrets" = "y" ]; then
        set_secrets "production"
    fi
    
    echo -e "\n${GREEN}✅ Production environment setup complete!${NC}"
    echo "Next steps:"
    echo "  1. Update wrangler.toml with the resource IDs shown above"
    echo "  2. Update .env.production with your Clerk publishable key"
    echo "  3. Deploy with: npm run deploy:prod"
fi

echo -e "\n${YELLOW}=== DNS CONFIGURATION ===${NC}"
echo "Add these DNS records in your Cloudflare dashboard for kizuna.ai:"
echo ""
echo "Development:"
echo "  Type: CNAME"
echo "  Name: sokuji-api-dev"
echo "  Target: [YOUR_WORKERS_DEV_SUBDOMAIN].workers.dev"
echo ""
echo "Production:"
echo "  Type: CNAME"
echo "  Name: sokuji-api"
echo "  Target: [YOUR_WORKERS_SUBDOMAIN].workers.dev"
echo ""
echo "Frontend (if using Cloudflare Pages):"
echo "  Development: dev.sokuji.kizuna.ai"
echo "  Production: sokuji.kizuna.ai"
echo ""

echo -e "${GREEN}🎉 Setup script complete!${NC}"
echo ""
echo "Testing commands:"
echo "  Development: curl https://sokuji-api-dev.kizuna.ai/api/health"
echo "  Production: curl https://sokuji-api.kizuna.ai/api/health"
echo ""
echo "Monitor logs:"
echo "  Development: npm run logs:dev"
echo "  Production: npm run logs:prod"