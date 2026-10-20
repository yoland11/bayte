import type {Session,SupabaseClient} from '@supabase/supabase-js';
import {CANONICAL_USER_ID} from './auth.js';

// Called only after centralized attempt reservation and successful Argon2 PIN verification.
// A direct server-managed password grant creates no recovery/OTP exchange capability.
// The internal credential is never the PIN and is never sent to the browser.
export async function issueExistingUserSession(
 admin:SupabaseClient,auth:SupabaseClient,expectedEmail:string,internalCredential:string
):Promise<Session>{
 if(!internalCredential||!expectedEmail)throw Error('Session issuance unavailable');
 const existing=await admin.auth.admin.getUserById(CANONICAL_USER_ID);
 const user=existing.data.user;
 if(existing.error||!user||user.id!==CANONICAL_USER_ID||user.is_anonymous||!user.email_confirmed_at||user.email!==expectedEmail)throw Error('Session issuance unavailable');
 const verified=await auth.auth.signInWithPassword({email:expectedEmail,password:internalCredential});
 const session=verified.data.session;
 if(!verified.error&&session?.access_token&&session.refresh_token&&session.user?.id===CANONICAL_USER_ID&&verified.data.user?.id===CANONICAL_USER_ID)return session;
 if(session?.access_token)await auth.auth.admin.signOut(session.access_token,'local');
 throw Error('Session issuance unavailable');
}
