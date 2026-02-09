require('dotenv').config(); 
const { Telegraf } = require('telegraf');
const { MongoClient } = require('mongodb');
const express = require('express');

// 1. CONFIGURATION
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_ID = parseInt(process.env.ADMIN_ID); 
const APP_URL = process.env.APP_URL;
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);
const client = new MongoClient(MONGO_URI);
const app = express();

let usersCollection;
let broadcastLogsCollection;

// 2. KEEP RENDER ALIVE (Express Server)
app.get('/', (req, res) => res.send('Afro Bot is Online!'));
app.listen(PORT, () => console.log(`✅ Port ${PORT} opened to keep Render happy.`));

// 3. CONNECT TO DATABASE
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

// 4. BOT LOGIC - USER REGISTRATION (Crash-Proofed)
bot.start(async (ctx) => {
    const userId = ctx.chat.id;

    try {
        // Save user to DB
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

        console.log(`👤 New User: ${ctx.from.first_name} (@${ctx.from.username || 'no_user'}) joined.`);

        // Attempt to welcome (wrapped in try/catch to prevent crash if blocked)
        await ctx.reply(`Welcome ${ctx.from.first_name} to Afro Leakers! 🔞`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Open Mini App", web_app: { url: APP_URL } }]
                ]
            }
        });
    } catch (err) {
        if (err.response && err.response.error_code === 403) {
            console.log(`🚫 User ${userId} blocked the bot. Skipping welcome.`);
        } else {
            console.error("❌ Start Error:", err.message);
        }
    }
});

// 5. STATS COMMAND
bot.command('stats', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("Unauthorized.");
    try {
        const totalUsers = await usersCollection.countDocuments();
        ctx.reply(`📊 **Afro Bot Stats**\n\nTotal Subscribers: ${totalUsers}`);
    } catch (err) {
        ctx.reply("Error fetching stats.");
    }
});

// 6. MANUAL BROADCAST (Crash-Proofed & Supports Media)
bot.command('send', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("Unauthorized.");

    const args = ctx.message.text.split(' ').slice(1);
    if (args.length === 0) return ctx.reply("Usage: /send [message] OR /send [url] [caption]");

    const firstArg = args[0];
    const isUrl = firstArg.startsWith('http');
    const mediaUrl = isUrl ? firstArg : null;
    const caption = isUrl ? args.slice(1).join(' ') : args.join(' ');

    const allUsers = await usersCollection.find({}).toArray();
    const broadcastId = Date.now().toString(); 
    let successCount = 0;
    let blockedCount = 0;

    ctx.reply(`🚀 Broadcasting to ${allUsers.length} users...`);

    for (const user of allUsers) {
        try {
            let sentMsg;
            if (isUrl) {
                if (mediaUrl.match(/\.(mp4|mov|avi)$/i)) {
                    sentMsg = await bot.telegram.sendVideo(user.chat_id, mediaUrl, { caption });
                } else {
                    sentMsg = await bot.telegram.sendPhoto(user.chat_id, mediaUrl, { caption });
                }
            } else {
                sentMsg = await bot.telegram.sendMessage(user.chat_id, caption);
            }
            
            await broadcastLogsCollection.insertOne({
                broadcast_id: broadcastId,
                chat_id: user.chat_id,
                message_id: sentMsg.message_id,
                sent_at: new Date()
            });

            successCount++;
            await new Promise(resolve => setTimeout(resolve, 50)); 
        } catch (err) {
            if (err.response && err.response.error_code === 403) {
                blockedCount++;
                // Clean up: Remove blocked users so they don't cause errors later
                await usersCollection.deleteOne({ chat_id: user.chat_id });
            } else {
                console.log(`Failed for ${user.chat_id}: ${err.message}`);
            }
        }
    }
    ctx.reply(`✅ Broadcast finished.\n\nSent: ${successCount}\nRemoved (Blocked): ${blockedCount}`);
});

// 7. UNDO COMMAND
bot.command('deleteall', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("Unauthorized.");

    const lastLog = await broadcastLogsCollection.find().sort({ sent_at: -1 }).limit(1).toArray();
    if (lastLog.length === 0) return ctx.reply("No history found.");

    const targetId = lastLog[0].broadcast_id;
    const messagesToDelete = await broadcastLogsCollection.find({ broadcast_id: targetId }).toArray();

    ctx.reply(`🗑 Deleting ${messagesToDelete.length} messages...`);

    for (const item of messagesToDelete) {
        try {
            await bot.telegram.deleteMessage(item.chat_id, item.message_id);
            await new Promise(resolve => setTimeout(resolve, 30)); 
        } catch (err) {
            console.log(`Could not delete for ${item.chat_id}`);
        }
    }

    await broadcastLogsCollection.deleteMany({ broadcast_id: targetId });
    ctx.reply(`✨ Successfully wiped.`);
});

// 8. STARTUP
connectDB().then(() => {
    // dropPendingUpdates: true fixes the 409 conflict error on restart
    bot.launch({ dropPendingUpdates: true });
    console.log("🚀 Bot is live, crash-proof, and secure!");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));