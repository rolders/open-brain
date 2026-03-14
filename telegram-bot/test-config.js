import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: join(__dirname, '..', '.env') });

const {
  TELEGRAM_BOT_TOKEN,
  OPENBRAIN_API_KEY,
  CAPTURE_API_URL = 'http://capture-api:3000'
} = process.env;

console.log('🧪 Testing Telegram Bot Configuration\n');

// Test 1: Check required environment variables
console.log('📋 Test 1: Environment Variables');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

let missingVars = [];
if (!TELEGRAM_BOT_TOKEN) {
  missingVars.push('TELEGRAM_BOT_TOKEN');
  console.log('❌ TELEGRAM_BOT_TOKEN is missing');
} else {
  console.log('✅ TELEGRAM_BOT_TOKEN:', TELEGRAM_BOT_TOKEN.substring(0, 10) + '...');
}

if (!OPENBRAIN_API_KEY) {
  missingVars.push('OPENBRAIN_API_KEY');
  console.log('❌ OPENBRAIN_API_KEY is missing');
} else {
  console.log('✅ OPENBRAIN_API_KEY:', OPENBRAIN_API_KEY.substring(0, 10) + '...');
}

console.log('✅ CAPTURE_API_URL:', CAPTURE_API_URL);

if (missingVars.length > 0) {
  console.log(`\n❌ Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

console.log('\n');

// Test 2: Validate Telegram bot token
async function testTelegramToken() {
  console.log('📋 Test 2: Telegram Bot Token Validation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    const response = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);

    if (response.data.ok) {
      const bot = response.data.result;
      console.log('✅ Bot token is valid!');
      console.log(`   Bot Name: ${bot.first_name}`);
      console.log(`   Bot Username: @${bot.username}`);
      console.log(`   Bot ID: ${bot.id}`);
      console.log(`   Can Join Groups: ${bot.can_join_groups}`);
      console.log(`   Can Read All Group Messages: ${bot.can_read_all_group_messages}`);
      console.log(`   Supports Inline Queries: ${bot.supports_inline_queries}`);
      return { success: true, bot };
    } else {
      console.log('❌ Bot token is invalid:', response.data.description);
      return { success: false, error: response.data.description };
    }
  } catch (error) {
    console.log('❌ Failed to validate token:', error.message);
    return { success: false, error: error.message };
  }
}

// Test 3: Initialize bot instance
async function testBotInitialization() {
  console.log('\n📋 Test 3: Bot Instance Initialization');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Try to initialize bot without polling
    const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
    console.log('✅ Bot instance created successfully');

    // Test getMe through the bot instance
    const botInfo = await bot.getMe();
    console.log('✅ Bot.getMe() call successful');
    console.log(`   Bot: @${botInfo.username}`);

    return { success: true, bot };
  } catch (error) {
    console.log('❌ Failed to initialize bot:', error.message);
    return { success: false, error: error.message };
  }
}

// Test 4: Check bot webhook status
async function testWebhookStatus() {
  console.log('\n📋 Test 4: Webhook Status');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    const response = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`);

    if (response.data.ok) {
      const webhookInfo = response.data.result;
      console.log('✅ Webhook info retrieved');

      if (webhookInfo.url) {
        console.log(`   ⚠️  Webhook is set to: ${webhookInfo.url}`);
        console.log('   ⚠️  Note: Bot uses polling, webhook may interfere');
      } else {
        console.log('   ✅ No webhook configured (good for polling mode)');
      }

      if (webhookInfo.pending_update_count > 0) {
        console.log(`   ⚠️  Pending updates: ${webhookInfo.pending_update_count}`);
      }

      return { success: true, webhookInfo };
    } else {
      console.log('❌ Failed to get webhook info:', response.data.description);
      return { success: false, error: response.data.description };
    }
  } catch (error) {
    console.log('❌ Failed to check webhook status:', error.message);
    return { success: false, error: error.message };
  }
}

// Test 5: Test API connectivity (if in Docker network)
async function testAPIConnectivity() {
  console.log('\n📋 Test 5: API Connectivity');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    const api = axios.create({
      baseURL: CAPTURE_API_URL,
      headers: {
        'Content-Type': 'application/json',
        'X-OpenBrain-Key': OPENBRAIN_API_KEY
      },
      timeout: 5000
    });

    // Try a simple health check (we'll just try to reach the server)
    console.log(`   Testing connection to: ${CAPTURE_API_URL}`);
    await api.get('/');
    console.log('✅ Connected to capture API');

    return { success: true };
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.log('⚠️  Cannot connect to capture API (this is expected if not running in Docker)');
      console.log('   This is OK - the bot will work when all services are running together');
      return { success: false, warning: 'API not reachable' };
    } else {
      console.log('⚠️  API connection issue:', error.message);
      return { success: false, error: error.message };
    }
  }
}

// Run all tests
async function runTests() {
  try {
    const tokenResult = await testTelegramToken();
    if (!tokenResult.success) {
      console.log('\n❌ Critical: Bot token is invalid. Please check TELEGRAM_BOT_TOKEN in .env');
      process.exit(1);
    }

    const initResult = await testBotInitialization();
    await testWebhookStatus();
    await testAPIConnectivity();

    console.log('\n' + '='.repeat(50));
    console.log('📊 Test Summary');
    console.log('='.repeat(50));

    if (tokenResult.success && initResult.success) {
      console.log('✅ Bot configuration is valid!');
      console.log('\n🚀 Your bot is ready to run.');
      console.log(`   Start it with: docker-compose up telegram-bot`);
      console.log(`   Or find your bot on Telegram: @${tokenResult.bot.username}`);
      console.log('\n💡 Send /start to your bot to begin!');
    } else {
      console.log('❌ Some tests failed. Please check the errors above.');
    }

  } catch (error) {
    console.error('\n💥 Unexpected error during testing:', error.message);
    process.exit(1);
  }
}

runTests();
