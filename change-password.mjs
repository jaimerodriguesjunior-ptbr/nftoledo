import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// 1. Read environment variables from .env.local
let env = {};
try {
  const fileContent = fs.readFileSync('.env.local', 'utf-8');
  env = Object.fromEntries(
    fileContent
      .split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => {
        const idx = l.indexOf('=');
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
      })
  );
} catch (e) {
  console.error('❌ Error reading .env.local file:', e.message);
  process.exit(1);
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in .env.local');
  process.exit(1);
}

// 2. Initialize Supabase Client with service role key (Admin rights)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function main() {
  const args = process.argv.slice(2);

  // If no arguments, list all users
  if (args.length === 0) {
    console.log('🔍 Fetching all users from Supabase Auth...');
    const { data, error } = await supabase.auth.admin.listUsers();

    if (error) {
      console.error('❌ Error listing users:', error.message);
      return;
    }

    const users = data.users;
    if (users.length === 0) {
      console.log('ℹ️ No users found in this Supabase project.');
      return;
    }

    console.log('\n=== REGISTERED USERS ===');
    users.forEach((user, index) => {
      const emailConfirmed = user.email_confirmed_at ? '✅ Confirmed' : '❌ Unconfirmed';
      console.log(`[${index + 1}] Email: ${user.email} (ID: ${user.id}) - Status: ${emailConfirmed}`);
    });

    console.log('\n💡 To change a user\'s password and confirm their email, run:');
    console.log('   node change-password.mjs <email> <new_password>\n');
    return;
  }

  if (args.length < 2) {
    console.log('❌ Usage: node change-password.mjs <email> <new_password>');
    return;
  }

  const [targetEmail, newPassword] = args;

  console.log(`🔍 Finding user with email: ${targetEmail}...`);
  const { data: listData, error: listError } = await supabase.auth.admin.listUsers();

  if (listError) {
    console.error('❌ Error listing users:', listError.message);
    return;
  }

  const user = listData.users.find(u => u.email?.toLowerCase() === targetEmail.toLowerCase());

  if (!user) {
    console.error(`❌ User not found with email: ${targetEmail}`);
    return;
  }

  console.log(`⚙️ Updating user ${targetEmail} (ID: ${user.id})...`);
  
  // Update password AND set email_confirm: true (since it is a fake email and can't be confirmed via inbox verification link)
  const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(
    user.id,
    { 
      password: newPassword,
      email_confirm: true // Force confirmation of the email so it is active
    }
  );

  if (updateError) {
    console.error('❌ Error updating user:', updateError.message);
    return;
  }

  console.log(`\n🎉 Success! Password updated for ${targetEmail}.`);
  console.log(`👉 The email was also marked as confirmed.`);
}

main().catch(console.error);
