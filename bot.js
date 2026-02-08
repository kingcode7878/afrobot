require('dotenv').config(); // This loads the .env file
const { Telegraf } = require('telegraf');
const { MongoClient } = require('mongodb');

// 1. CONFIGURATION (Now pulled from .env)
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_ID = parseInt(process.env.ADMIN_ID); // Convert string to number
const APP_URL = process.env.APP_URL;

const bot = new Telegraf(BOT_TOKEN);
const client = new MongoClient(MONGO_URI);

let usersCollection;

// 2. CONNECT TO DATABASE
async function connectDB() {
    try {
        await client.connect();
        const database = client.db('afro_leaks_db');
        usersCollection = database.collection('users');
        console.log("✅ Connected to MongoDB via Env Variables");
    } catch (e) {
        console.error("❌ MongoDB Connection Error:", e);
    }
}

// 3. BOT LOGIC
bot.start(async (ctx) => {
    const userId = ctx.chat.id;

    await usersCollection.updateOne(
        { chat_id: userId },
        { 
            $set: { 
                username: ctx.from.username || "anonymous",
                last_active: new Date()
            } 
        },
        { upsert: true }
    );

    ctx.reply("Welcome to Afro Leakers! 🔞", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Open Mini App", web_app: { url: APP_URL } }]
            ]
        }
    });
});

// 4. MANUAL BROADCAST
bot.command('send', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("Unauthorized.");

    const text = ctx.message.text.split(' ').slice(1).join(' ');
    if (!text) return ctx.reply("Usage: /send [your message]");

    const allUsers = await usersCollection.find({}).toArray();
    let successCount = 0;

    ctx.reply(`Broadcasting to ${allUsers.length} users...`);

    for (const user of allUsers) {
        try {
            await bot.telegram.sendMessage(user.chat_id, text);
            successCount++;
            await new Promise(resolve => setTimeout(resolve, 50)); 
        } catch (err) {
            console.log(`Failed for ${user.chat_id}`);
        }
    }

    ctx.reply(`✅ Broadcast finished. Sent to ${successCount} users.`);
});

connectDB().then(() => {
    bot.launch();
    console.log("🚀 Bot is live and secure!");
});