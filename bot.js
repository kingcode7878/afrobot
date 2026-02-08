require('dotenv').config(); 
const { Telegraf } = require('telegraf');
const { MongoClient } = require('mongodb');

// 1. CONFIGURATION
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_ID = parseInt(process.env.ADMIN_ID); 
const APP_URL = process.env.APP_URL;

const bot = new Telegraf(BOT_TOKEN);
const client = new MongoClient(MONGO_URI);

let usersCollection;
let broadcastLogsCollection;

// 2. CONNECT TO DATABASE
async function connectDB() {
    try {
        await client.connect();
        const database = client.db('afro_leaks_db');
        
        usersCollection = database.collection('users');
        broadcastLogsCollection = database.collection('broadcast_logs');
        
        console.log("✅ Connected to MongoDB via Env Variables");
    } catch (e) {
        console.error("❌ MongoDB Connection Error:", e);
    }
}

// 3. BOT LOGIC - USER REGISTRATION
bot.start(async (ctx) => {
    const userId = ctx.chat.id;

    await usersCollection.updateOne(
        { chat_id: userId },
        { 
            $set: { 
                username: ctx.from.username || "anonymous",
                first_name: ctx.from.first_name || "User",
                last_active: new Date()
            } 
        },
        { upsert: true }
    );

    console.log(`👤 New User: ${ctx.from.first_name} (@${ctx.from.username}) joined.`);

    ctx.reply(`Welcome ${ctx.from.first_name} to Afro Leakers! 🔞`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Open Mini App", web_app: { url: APP_URL } }]
            ]
        }
    });
});

// 4. STATS COMMAND (New!)
bot.command('stats', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("Unauthorized.");

    const totalUsers = await usersCollection.countDocuments();
    
    ctx.reply(`📊 **Afro Bot Stats**\n\nTotal Subscribers: ${totalUsers}`);
});

// 5. MANUAL BROADCAST
bot.command('send', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("Unauthorized.");

    const text = ctx.message.text.split(' ').slice(1).join(' ');
    if (!text) return ctx.reply("Usage: /send [your message]");

    const allUsers = await usersCollection.find({}).toArray();
    const broadcastId = Date.now().toString(); 
    let successCount = 0;

    ctx.reply(`🚀 Broadcasting to ${allUsers.length} users...`);

    for (const user of allUsers) {
        try {
            const sentMsg = await bot.telegram.sendMessage(user.chat_id, text);
            
            await broadcastLogsCollection.insertOne({
                broadcast_id: broadcastId,
                chat_id: user.chat_id,
                message_id: sentMsg.message_id,
                sent_at: new Date()
            });

            successCount++;
            await new Promise(resolve => setTimeout(resolve, 50)); 
        } catch (err) {
            console.log(`Failed for ${user.chat_id}`);
        }
    }

    ctx.reply(`✅ Broadcast finished. Sent to ${successCount} users.\n\nUse /deleteall to undo.`);
});

// 6. UNDO COMMAND
bot.command('deleteall', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("Unauthorized.");

    const lastLog = await broadcastLogsCollection.find().sort({ sent_at: -1 }).limit(1).toArray();
    if (lastLog.length === 0) return ctx.reply("No broadcast history found.");

    const targetId = lastLog[0].broadcast_id;
    const messagesToDelete = await broadcastLogsCollection.find({ broadcast_id: targetId }).toArray();

    ctx.reply(`🗑 Deleting ${messagesToDelete.length} messages...`);

    let deletedCount = 0;
    for (const item of messagesToDelete) {
        try {
            await bot.telegram.deleteMessage(item.chat_id, item.message_id);
            deletedCount++;
            await new Promise(resolve => setTimeout(resolve, 30)); 
        } catch (err) {
            console.log(`Could not delete for ${item.chat_id}`);
        }
    }

    await broadcastLogsCollection.deleteMany({ broadcast_id: targetId });
    ctx.reply(`✨ Successfully wiped ${deletedCount} messages.`);
});

// START
connectDB().then(() => {
    bot.launch();
    console.log("🚀 Bot is live and counting!");
});

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Bot is running!'));

app.listen(PORT, () => {
    console.log(`Port ${PORT} opened to keep Render happy.`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));