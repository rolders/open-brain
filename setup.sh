#!/bin/bash
set -e

echo "🧠 Open Brain Setup"
echo "====================="
echo ""

# Check if .env exists
if [ -f .env ]; then
    echo "⚠️  .env file already exists. Skipping generation."
else
    echo "📝 Generating secure credentials..."

    # Generate secure random values
    OPENBRAIN_API_KEY=$(openssl rand -hex 32)
    DB_PASSWORD=$(openssl rand -hex 32)

    # Create .env file
    cat > .env << EOF
# Security
OPENBRAIN_API_KEY=$OPENBRAIN_API_KEY
DB_PASSWORD=$DB_PASSWORD

# AI Services
OPENAI_API_KEY=your_openai_api_key_here

# Internal Database
DB_HOST=db
DB_PORT=5432
DB_NAME=openbrain
EOF

    echo "✅ .env file created"
fi

# Check if init.sql needs password update
if grep -q "REPLACE_WITH_DB_PASSWORD_FROM_ENV" init.sql; then
    echo ""
    echo "🔧 Updating init.sql with database password..."

    # Source the .env file
    source .env

    # Update init.sql with the actual password
    sed -i "s/REPLACE_WITH_DB_PASSWORD_FROM_ENV/$DB_PASSWORD/g" init.sql

    echo "✅ init.sql updated"
else
    echo "⚠️  init.sql already configured"
fi

echo ""
echo "⚠️  IMPORTANT: Edit .env and add your OpenAI API key:"
echo "   OPENAI_API_KEY=sk-..."
echo ""
echo "🚀 Ready to start! Run:"
echo "   docker-compose up -d"
echo ""
echo "📖 See README.md for usage instructions"
