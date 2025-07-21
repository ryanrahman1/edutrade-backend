const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config(); // 🧪 Load .env variables


const app = express();
app.use(cors());
app.use(express.json());

// DATABASE

// Supabase admin client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Hash password
app.post('/api/hash', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Missing password' });

  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);
  res.json({ hash });
});

// Verify password
app.post('/api/verify', async (req, res) => {
  const { password, hash } = req.body;
  if (!password || !hash) return res.status(400).json({ error: 'Missing data' });

  const match = await bcrypt.compare(password, hash);
  res.json({ match });
});

//get profile info
app.get('/api/profile', async (req, res) => {
  const { username } = req.query;

  if (!username) return res.status(400).json({ erorr: 'Missing email'});

  const { data, error } = await supabase
  .from('users')
  .select('id, username, email, bio,  created_at, is_admin')
  .eq('username', username)
  .single();

  if (error) {
    return res.status(500).json({ error: error.message});
  }

  if (!data) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.status(200).json({ profile: data });
});

//change password
app.put('/api/profile/password', async (req, res) => {
  const { email, password, newPassword } = req.body;
  if (!email || !password || !newPassword) {
    return res.status(400).json({ error: 'Missing data' });
  }
  const { data: user, error: fetchError } = await supabase
  .from('users')
  .select('password')
  .eq('email', email)
  .single();

  if (fetchError || !user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const salt = await bcrypt.genSalt(10);
  const newHash = await bcrypt.hash(newPassword, salt);

  const { error: updateError } = await supabase
  .from('users')
  .update({ password: newHash })
  .eq('email', email);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to update password' });
  }

  res.status(200).json({ message: 'Password updated successfully' });
});

//change username
app.put('/api/profile/username', async (req, res) => {
  const { email, newUsername } = req.body;
  if (!email || !newUsername) {
    return res.status(400).json({ error: 'Missing Data'});
  }

  const {data: existing, error: checkError } = await supabase
  .from('users')
  .select('id')
  .eq('username', newUsername)
  .single();

  if (existing) {
    return res.status(409).json({error: 'Username already exists' });
  }

  const { error: updateError } = await supabase
  .from('users')
  .update({ username: newUsername })
  .eq('email', email);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to update Username' });
  }

  res.status(200).json({ message: 'Username updated succesfully' });
});

//delete profile
app.delete('/api/delete-profile', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing data' });
  }

  // Get user + hash
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, password')
    .eq('email', email)
    .single();

  if (userError || !user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  // Delete holdings + transactions tied to portfolio
  const { data: portfolio, error: portfolioFetchErr } = await supabase
    .from('portfolios')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (portfolioFetchErr || !portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  const portfolioId = portfolio.id;

  await supabase.from('transactions').delete().eq('portfolio_id', portfolioId);
  await supabase.from('holdings').delete().eq('portfolio_id', portfolioId);
  await supabase.from('portfolios').delete().eq('id', portfolioId);
  await supabase.from('users').delete().eq('id', user.id);

  res.status(200).json({ message: 'Account and all data deleted.' });
});

//get portfolio
app.get('/api/portfolio', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  // Get user ID from email
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  if (userError || !userData) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userId = userData.id;

  // Get portfolio for user ID
  const { data: portfolio, error: portfolioError } = await supabase
    .from('portfolios')
    .select('id, cash_balance, total_value, created_at')
    .eq('user_id', userId)
    .single();

  if (portfolioError || !portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  const portfolioId = portfolio.id;

  // Get holdings
  const { data: holdings, error: holdingsError } = await supabase
    .from('holdings')
    .select('symbol, shares, current_price')
    .eq('portfolio_id', portfolioId);

  if (holdingsError) {
    return res.status(500).json({ error: 'Failed to fetch holdings' });
  }

  // Get transactions
  const { data: transactions, error: transactionsError } = await supabase
    .from('transactions')
    .select('id, symbol, shares, price_per_share, transaction_type, transaction_date')
    .eq('portfolio_id', portfolioId)
    .order('transaction_date', { ascending: false });

  if (transactionsError) {
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }

  // Calculate holdings value
  let holdingsValue = 0;
  if (Array.isArray(holdings)) {
    holdings.forEach(h => {
      holdingsValue += h.shares * h.current_price;
    });
  }

  const totalValue = portfolio.cash_balance + holdingsValue;

  // Update total_value in portfolio
  await supabase
    .from('portfolios')
    .update({ total_value: totalValue })
    .eq('id', portfolioId);

  // Respond with updated portfolio, holdings, and transactions
  res.status(200).json({
    portfolio: {
      id: portfolioId,
      cash_balance: portfolio.cash_balance,
      total_value: totalValue,
      created_at: portfolio.created_at
    },
    holdings: holdings || [],
    transactions: transactions || []
  });
});


//get portfolio history
app.get('/api/portfolio-history', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  // Get user ID from email
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  if (userError || !userData) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userId = userData.id;

  // Get portfolio for user ID
  const { data: portfolio, error: portfolioError } = await supabase
    .from('portfolios')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (portfolioError || !portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  const portfolioId = portfolio.id;

  // Get portfolio history for last 30 days
  const { data: history, error: historyError } = await supabase
    .from('portfolio_history')
    .select('snapshot_date, total_value')
    .eq('portfolio_id', portfolioId)
    .gte('snapshot_date', new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0]) // 30 days ago as yyyy-mm-dd
    .order('snapshot_date', { ascending: true });

  if (historyError) {
    return res.status(500).json({ error: 'Failed to fetch portfolio history' });
  }

  res.status(200).json(history || []);
});

//snapshot portfolio
app.post('/api/snapshot-portfolios', async (req, res) => {
  try {
    // Fetch all portfolios
    const { data: portfolios, error } = await supabase
      .from('portfolios')
      .select('id, cash_balance, total_value');

    if (error) throw error;

    // For each portfolio, insert snapshot
    const snapshotPromises = portfolios.map(p =>
      supabase
        .from('portfolio_history')
        .insert({
          portfolio_id: p.id,
          total_value: p.total_value,
          cash_balance: p.cash_balance,
          snapshot_date: new Date().toISOString().split('T')[0]  // YYYY-MM-DD
      })
    );

    await Promise.all(snapshotPromises);

    res.status(200).json({ message: 'Snapshots saved for all portfolios' });
  } catch (err) {
    console.error('Snapshot error:', err);
    res.status(500).json({ error: 'Failed to save portfolio snapshots' });
  }
});

// FRIENDS + SOCIAL

//send friend request
app.post('/api/friends/request', async (req, res) => {
  const { email, targetUsername } = req.body;
  if (!email || !targetUsername) {
    return res.status(400).json({ error: 'Missing email or targetUsername' });
  }

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  const { data: targetUser, error: targetUserError } = await supabase
    .from('users')
    .select('id')
    .eq('username', targetUsername)
    .single();

  if (userError || !user || targetUserError || !targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userId = user.id;
  const targetUserId = targetUser.id;

  if (userId === targetUserId) {
    return res.status(400).json({ error: 'You can’t friend yourself' });
  }

  const { data: existing, error: existingError } = await supabase
    .from('friends')
    .select('status')
    .or(`and(user_id.eq.${userId},friend_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},friend_id.eq.${userId})`)
    .single();

  if (existing) {
    return res.status(400).json({ error: 'Friend request already exists or you are already friends' });
  }

  const { error: requestError } = await supabase
    .from('friends')
    .insert({
      user_id: userId,
      friend_id: targetUserId,
      status: 'pending'
    });

  if (requestError) {
    return res.status(500).json({ error: 'Failed to send friend request' });
  }

  res.status(200).json({ message: 'Friend request sent successfully' });
});


//accept reject or block friend request
app.post('/api/friends/response', async (req, res) => {
  const { email, targetUsername, action } = req.body;
  if (!email || !targetUsername || !action) {
    return res.status(400).json({ error: 'Missing email, targetUsername, or action' });
  }

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  const { data: targetUser, error: targetUserError } = await supabase
    .from('users')
    .select('id')
    .eq('username', targetUsername)
    .single();

  if (userError || !user || targetUserError || !targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userId = user.id;
  const targetUserId = targetUser.id;

  const { data: request, error: requestError } = await supabase
    .from('friends')
    .select('id')
    .or(`and(user_id.eq.${userId},friend_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},friend_id.eq.${userId})`)
    .eq('status', 'pending')
    .single();

  if (requestError || !request) {
    return res.status(404).json({ error: 'Pending request not found' });
  }

  let updatedStatus = null;
  if (action === 'accept') updatedStatus = 'accepted';
  else if (action === 'reject') updatedStatus = 'rejected';
  else if (action === 'block') updatedStatus = 'blocked';
  else return res.status(400).json({ error: 'Invalid action' });

  const { error: updateError } = await supabase
    .from('friends')
    .update({ status: updatedStatus })
    .eq('id', request.id);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to update friend request' });
  }

  res.status(200).json({ message: 'Friend request updated successfully' });
});


//remove friend
app.post('/api/friends/remove', async (req, res) => {
  const { email, targetUsername } = req.body;
  if (!email || !targetUsername) {
    return res.status(400).json({ error: 'Missing email or targetUsername' });
  }

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  const { data: targetUser, error: targetUserError } = await supabase
    .from('users')
    .select('id')
    .eq('username', targetUsername)
    .single();

  if (userError || !user || targetUserError || !targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userId = user.id;
  const targetUserId = targetUser.id;

  const { error: removeError } = await supabase
    .from('friends')
    .delete()
    .or(`and(user_id.eq.${userId},friend_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},friend_id.eq.${userId})`);

  if (removeError) {
    return res.status(500).json({ error: 'Failed to remove friend' });
  }

  res.status(200).json({ message: 'Friend removed successfully' });
});


//get friends list
app.get('/api/friends', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  if (userError || !user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userId = user.id;

  const { data: friendRows, error: friendError } = await supabase
    .from('friends')
    .select('user_id, friend_id')
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
    .eq('status', 'accepted');

  if (friendError) {
    return res.status(500).json({ error: 'Failed to fetch friends' });
  }

  const friendIds = friendRows.map(row =>
    row.user_id === userId ? row.friend_id : row.user_id
  );

  if (friendIds.length === 0) {
    return res.status(200).json({ friends: [] });
  }

  const { data: friendDetails, error: detailError } = await supabase
    .from('users')
    .select('id, username, email')
    .in('id', friendIds);

  if (detailError) {
    return res.status(500).json({ error: 'Failed to fetch friend details' });
  }

  res.status(200).json({ friends: friendDetails });
});


//get pending requests
app.get('/api/friends/pending', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  if (userError || !user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userId = user.id;

  const { data: requests, error: pendingError } = await supabase
    .from('friends')
    .select('user_id')
    .eq('friend_id', userId)
    .eq('status', 'pending');

  if (pendingError) {
    return res.status(500).json({ error: 'Failed to fetch pending requests' });
  }

  const senderIds = requests.map(req => req.user_id);

  if (senderIds.length === 0) return res.status(200).json({ pending: [] });

  const { data: senders, error: senderError } = await supabase
    .from('users')
    .select('id, username, email')
    .in('id', senderIds);

  if (senderError) {
    return res.status(500).json({ error: 'Failed to fetch sender info' });
  }

  res.status(200).json({ pending: senders });
});


//get sent requests
app.get('/api/friends/sent', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  if (userError || !user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userId = user.id;

  const { data: requests, error: sentError } = await supabase
    .from('friends')
    .select('friend_id')
    .eq('user_id', userId)
    .eq('status', 'pending');

  if (sentError) {
    return res.status(500).json({ error: 'Failed to fetch sent requests' });
  }

  const recipientIds = requests.map(req => req.friend_id);

  if (recipientIds.length === 0) return res.status(200).json({ sent: [] });

  const { data: recipients, error: recipientError } = await supabase
    .from('users')
    .select('id, username, email')
    .in('id', recipientIds);

  if (recipientError) {
    return res.status(500).json({ error: 'Failed to fetch recipient info' });
  }

  res.status(200).json({ sent: recipients });
});


//get friend status
app.get('/api/friends/status', async (req, res) => {
  const { email, targetUsername } = req.query;
  if (!email || !targetUsername) {
    return res.status(400).json({ error: 'Missing email or targetUsername' });
  }

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  const { data: target, error: targetError } = await supabase
    .from('users')
    .select('id')
    .eq('username', targetUsername)
    .single();

  if (userError || !user || targetError || !target) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userId = user.id;
  const targetId = target.id;

  if (userId === targetId) {
    return res.status(200).json({ status: 'self' });
  }

  const { data: relationship, error: statusError } = await supabase
    .from('friends')
    .select('user_id, friend_id, status')
    .or(`and(user_id.eq.${userId},friend_id.eq.${targetId}),and(user_id.eq.${targetId},friend_id.eq.${userId})`)
    .single();

  if (!relationship) {
    return res.status(200).json({ status: 'none' });
  }

  let type = relationship.status;
  if (type === 'pending') {
    type = relationship.user_id === userId ? 'sent' : 'received';
  }

  res.status(200).json({ status: type });
});

// ANNOUNCEMENTS

//get announcements
app.get('/api/announcement/pinned', async (req, res) =>{
  const {data, error} = await supabase
  .from("announcements")
    .select("id, title, content, created_at, username, is_pinned")
    .eq("is_pinned", true)

  if (error) {
    console.error("Failed to fetch pinned announcements:", error);
    return res.status(500).json({ error: 'Failed to fetch pinned announcements' });
  }

  res.status(200).json(data);
});



//create announcement
app.post('/api/admin/announcements', async (req, res) => {});

// pin announcement
app.put('/api/admin/announcements/:id/pin', async (req, res) => {});

//delete announcement
app.delete('/api/admin/announcements/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'Missing announcement ID' });


  //set is pinned false
  const { error } = await supabase
    .from('announcements')
    .update({ is_pinned: false })
    .eq('id', id);

  if (error) {
    console.error("Failed to delete announcement:", error);
    return res.status(500).json({ error: 'Failed to delete announcement' });
  }

  res.status(200).json({ message: 'Announcement unpinned' });
});

// CHAT - PLACEHOLDER, REPLACE WITH WEBSOCKET IMPLEMENTATION

/*
//send message
app.post('/api/chat/send', async (req, res) => {});

//get dm
app.get('/api/chat/dm:user_id', async (req, res) => {});

//group chat
app.get('/api/chat/group:group_id', async (req, res) => {});

//public chat
app.get('/api/chat/public', async (req, res) => {});

// get groups user is in
app.get('/api/chat/rooms', async (req, res) => {});

//create group
app.post('/api/chat/group/create', async (req, res) => {});

//add member to group
app.put('/api/chat/group/:id/add-member', async (req, res) => {});

//remove member
app.put('/api/chat/group/:id/remove-member', async (req, res) => {});

//delete group chat message
app.delete('/api/chat/message/:id', async (req, res) => {});
*/

//GROUPS : V2

/*
//get all public/user groups
app.get('/api/groups', async (req, res) => {});

//create group
app.post('/api/groups/', async (req, res) => {});

//get group info
app.get('/api/groups/:id', async (req, res) => {});

//update member list
app.put('/api/groups/:id/members', async (req, res) => {});

//delete group (admin only)
app.delete('/api/admin/groups/:id', async (req, res) => {});

*/


//QOTD

//get todays question + answer
app.get('/api/qotd', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]; // format: YYYY-MM-DD

    const { data: question, error } = await supabase
      .from('daily_questions')
      .select('id, question_text, answer_text, explanation, choices, created_at')
      .filter('created_at', 'gte', `${today}T00:00:00`)
      .filter('created_at', 'lt', `${today}T23:59:59`)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!question) {
      return res.status(404).json({ error: 'No question found for today' });
    }

    res.status(200).json(question);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to get QOTD' });
  }
});

// Check if user answered today's QOTD
app.post('/api/qotd/check-answered', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  try {
    // get user id from email
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();
    if (userError || !user) return res.status(404).json({ error: 'User not found' });

    // get today's QOTD id
    const today = new Date().toISOString().split('T')[0];
    const { data: question, error: qError } = await supabase
      .from('daily_questions')
      .select('id, created_at')
      .filter('created_at', 'gte', `${today}T00:00:00`)
      .filter('created_at', 'lt', `${today}T23:59:59`)
      .limit(1)
      .maybeSingle();
    if (qError) throw qError;
    if (!question) return res.status(404).json({ error: 'No question for today' });

    // check if user answered
    const { data: answered, error: ansError } = await supabase
      .from('user_qotd_answers')
      .select('*')
      .eq('user_id', user.id)
      .eq('question_id', question.id)
      .single();

    if (ansError && ansError.code !== 'PGRST116') throw ansError; // PGRST116 = no rows

    res.status(200).json({ answered: !!answered });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to check answered status' });
  }
});

// Mark user as answered today's QOTD
app.post('/api/qotd/answer', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  try {
    // get user id from email
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();
    if (userError || !user) return res.status(404).json({ error: 'User not found' });

    // get today's QOTD id
    const today = new Date().toISOString().split('T')[0];
    const { data: question, error: qError } = await supabase
      .from('daily_questions')
      .select('id, created_at')
      .filter('created_at', 'gte', `${today}T00:00:00`)
      .filter('created_at', 'lt', `${today}T23:59:59`)
      .limit(1)
      .maybeSingle();
    if (qError) throw qError;
    if (!question) return res.status(404).json({ error: 'No question for today' });

    // insert into user_qotd_answers if not exists (ignore conflict)
    const { error: insertError } = await supabase
      .from('user_qotd_answers')
      .insert([{ user_id: user.id, question_id: question.id }])
      .select()
      .single();

    if (insertError && !insertError.message.includes('duplicate key')) {
      throw insertError;
    }

    res.status(200).json({ message: 'Marked as answered' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to mark answer' });
  }
});

//get top 10 users, based on portfolio value
app.get('/api/top-users', async (req, res) => {
  try {
    const { data: portfolios, error: portfolioError } = await supabase
      .from('portfolios')
      .select('user_id, total_value')
      .order('total_value', { ascending: false })
      .limit(10);

    if (portfolioError) throw portfolioError;
    if (!portfolios || portfolios.length === 0)
      return res.status(404).json({ error: 'No users found' });

    const userIds = portfolios.map(p => p.user_id);
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, username')
      .in('id', userIds);

    if (userError) throw userError;

    const topUsers = portfolios.map((p, i) => {
      const user = users.find(u => u.id === p.user_id);
      return {
        rank: i + 1,
        user_id: p.user_id,
        username: user ? user.username : 'Unknown',
        total_value: p.total_value
      };
    });

    res.status(200).json(topUsers);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch top users' });
  }
});

//question history
app.get('/api/qotd/history', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('daily_questions')
      .select('id, question_text, answer_text, explanation, created_at')
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch QOTD history' });
  }
});

//create new question (admin only)
app.post('/api/admin/qotd', async (req, res) => {
  const { question_text, answer_text, explanation, isAdmin } = req.body;

  if (!isAdmin) return res.status(403).json({ error: 'Unauthorized' });
  if (!question_text || !answer_text) {
    return res.status(400).json({ error: 'Question text and answer required' });
  }

  try {
    const { data, error } = await supabase
      .from('daily_questions')
      .insert([{ question_text, answer_text, explanation }]);

    if (error) throw error;
    res.status(201).json({ message: 'Question created', question: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create question' });
  }
});

//delete question (admin only)
app.delete('/api/admin/qotd/:id', async (req, res) => {
  const { id } = req.params;
  const { isAdmin } = req.body;

  if (!isAdmin) return res.status(403).json({ error: 'Unauthorized' });

  try {
    const { data, error } = await supabase
      .from('daily_questions')
      .delete()
      .eq('id', id);

    if (error) throw error;
    if (!data.length) return res.status(404).json({ error: 'Question not found' });

    res.status(200).json({ message: 'Question deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete question' });
  }
});


// ADMIN PANEL

app.put('/api/admin/promote/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { adminPassword } = req.body;

  // Hardcoded admin password (change this to env var in prod)
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!adminPassword || adminPassword !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Unauthorized: wrong admin password' });
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .update({ is_admin: true })
      .eq('id', user_id);

    if (error) throw error;
    if (!data.length) return res.status(404).json({ error: 'User not found' });

    res.status(200).json({ message: `User ${user_id} promoted to admin` });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to promote user' });
  }
});


//get recent activity - MAYBE
app.get('/api/admin/activity', async (req, res) => {});

//get all users
app.get('/api/admin/users', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email'});

  //Check if user is admin
  const { data: user, error: userError } = await supabase
  .from('users')
  .select('is_admin')
  .eq('email', email)
  .single();

  if (userError || !user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (!user.is_admin) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Get all users
  const { data: users, error: usersError } = await supabase
  .from('users')
  .select('id, username, email, created_at, is_admin')
  .order('created_at', { ascending: false });

  if (usersError || !users) {
    return res.status(500).json({ error: 'Failed to fetch users' });
  }

  res.status(200).json({ users });
});

//delete user

app.delete('/api/admin/delete-user', async (req, res) => {
  const { email, targetEmail, adminPassword } = req.body;
  if (!email || !targetEmail || !adminPassword) return res.status(400).json({ error: 'Missing email or targetEmail' });
  // Check if user is admin
  const { data: user, error: userError } = await supabase
  .from('users')
  .select('is_admin')
  .eq('email', email)
  .single();

  if (userError || !user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (!user.is_admin) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (adminPassword !== process.env.ADMIN_PASSWORD) { 
    return res.status(403).json({ error: 'Invalid admin password' });
  }

  // Get target user ID
  const { data: targetUser, error: targetUserError } = await supabase
  .from('users')
  .select('id, username')
  .eq('email', targetEmail)
  .single();

  if (targetUserError || !targetUser) {
    return res.status(404).json({ error: 'Target user not found' });
  }

  const targetUserId = targetUser.id;

  // Delete holdings, transactions, and portfolio for target user
  const { data: targetPortfolio, error: portfolioFetchErr } = await supabase
    .from('portfolios')
    .select('id')
    .eq('user_id', targetUserId)
    .single();

  if (portfolioFetchErr || !targetPortfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  const portfolioId = targetPortfolio.id;

  await supabase.from('transactions').delete().eq('portfolio_id', portfolioId);
  await supabase.from('holdings').delete().eq('portfolio_id', portfolioId);
  await supabase.from('portfolios').delete().eq('id', portfolioId);
  await supabase.from('users').delete().eq('id', targetUserId);

  res.status(200).json({ message: `User ${targetUser.username} and all data deleted successfully` });


});

//extra social

//search user by id
app.get('/api/users/search', async (req, res) => {
  const { id } = req.query;

  if (!id) return res.status(400).json({ error: 'Missing user id' });

  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, username, email, is_admin, created_at')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'User not found' });

    res.status(200).json({ user: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to search user' });
  }
});


//report user v2
//app.post('/api/report', async (req, res) => {});

//get holdings for portfolio
app.get('/api/holdings', async (req, res) => {
  const { portfolioId } = req.query;
  if (!portfolioId) return res.status(400).json({ error: 'Missing portfolioId' });

  const { data, error } = await supabase
  .from('holdings')
  .select('symbol, shares, average_cost, current_price')
  .eq('portfolio_id', portfolioId)

  if (error || !data) {
    return res.status(404).json({ error: 'Holdings not found' });
  }

  res.status(200).json({ holdings: data });
});

//get transactions for portfolio
app.get('/api/transactions', async (req, res) => {
  const { portfolioId } = req.query;
  if (!portfolioId) return res.status(400).json({ error: 'Missing portfolioId' });

  const { data, error } = await supabase
  .from('transactions')
  .select('symbol, transaction_type, shares, price_per_share, total_amount, transaction_date')
  .eq('portfolio_id', portfolioId)
  .order('transaction_date', { ascending: false });

  if (error || !data) {
    return res.status(404).json({ error: 'Transactions not found' });
  }

  res.status(200).json({ transactions: data });
});

app.get('/api/dashboard', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  // Get user ID
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  if (userError || !userData) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userId = userData.id;

  // Get portfolio
  const { data: portfolio, error: portfolioError } = await supabase
    .from('portfolios')
    .select('id, cash_balance, total_value, created_at')
    .eq('user_id', userId)
    .single();

  if (portfolioError || !portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  const portfolioId = portfolio.id;

  // Get holdings
  const { data: holdings, error: holdingsError } = await supabase
    .from('holdings')
    .select('symbol, shares, average_cost, current_price')
    .eq('portfolio_id', portfolioId);

  if (holdingsError) {
    return res.status(500).json({ error: 'Failed to fetch holdings' });
  }

  // Get transactions
  const { data: transactions, error: transactionsError } = await supabase
    .from('transactions')
    .select('symbol, transaction_type, shares, price_per_share, total_amount, transaction_date')
    .eq('portfolio_id', portfolioId)
    .order('transaction_date', { ascending: false });

  if (transactionsError) {
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }

  // Calculate total value = cash + value of holdings
  let holdingsValue = 0;
  if (Array.isArray(holdings)) {
    holdings.forEach(h => {
      holdingsValue += h.shares * h.current_price;
    });
  }

  const totalValue = portfolio.cash_balance + holdingsValue;

  // Update total_value in DB
  await supabase
    .from('portfolios')
    .update({ total_value: totalValue })
    .eq('id', portfolioId);

  // Respond
  res.status(200).json({
    portfolio: {
      id: portfolioId,
      cash_balance: portfolio.cash_balance,
      total_value: totalValue,
      created_at: portfolio.created_at,
    },
    holdings,
    transactions,
  });
});

// END DATABASE



// TRADING ENDPOINTS


//make trade, either buy or sell
app.post('/api/trade', async (req, res) => { 
  const { email, symbol, shares, transactionType } = req.body;
  if (!email || !symbol || !shares || !transactionType) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const normalizedType = transactionType.toLowerCase();
  if (!['buy', 'sell'].includes(normalizedType)) {
    return res.status(400).json({ error: 'Invalid transaction type' });
  }

  // Get user ID
  const { data: userData, error: userError } = await supabase
  .from('users')
  .select('id')
  .eq('email', email)
  .single();

  if (userError || !userData) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userId = userData.id;

  // Get portfolio
  const { data: portfolioData, error: portfolioError } = await supabase
  .from('portfolios')
  .select('id, cash_balance')
  .eq('user_id', userId)
  .single();

  if (portfolioError || !portfolioData) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  const portfolioId = portfolioData.id;
  let cash = portfolioData.cash_balance;

  //get price
  const quote = await marketData.getQuote(symbol); //returns with quote
  if (!quote || !quote.regularMarketPrice) {
    return res.status(500).json({ error: 'Failed to fetch stock price' });
  }
  const currentPrice = quote.regularMarketPrice;
  if (!currentPrice || currentPrice <= 0) {
    return res.status(400).json({ error: 'Invalid stock price' });
  }

  const totalCost = currentPrice * shares;

  if (normalizedType === 'buy') {
    if (cash < totalCost) {
      return res.status(400).json({ error: 'Insufficient funds to buy shares' });
    }

    //upsert holding
    await supabase.rpc('upsert_holding', {
      portfolio_id_input: portfolioId,
      symbol_input: symbol,
      shares_input: shares,
      price_input: currentPrice
    }, { onConflict: ['portfolio_id', 'symbol'] } // VERY important
  );

    //update portfolio cash
    await supabase
    .from('portfolios')
    .update({ cash_balance: cash - totalCost })
    .eq('id', portfolioId);
  } else if (normalizedType === 'sell') {
    //get current holding
    const { data: holding, error: holdingError } = await supabase
    .from('holdings')
    .select('shares, average_cost')
    .eq('portfolio_id', portfolioId)
    .eq('symbol', symbol)
    .single();

    if (holdingError || !holding || holding.shares < shares) {
      return res.status(400).json({ error: 'Insufficient shares to sell' });
    }

    const newShares = holding.shares - shares;
    
    if (newShares === 0 ) {
      await supabase
      .from('holdings')
      .delete()
      .eq('portfolio_id', portfolioId)
      .eq('symbol', symbol);
    } else {
      await supabase
      .from('holdings')
      .update({ shares: newShares})
      .eq('portfolio_id', portfolioId)
      .eq('symbol', symbol);
    }

    await supabase
    .from('portfolios')
    .update({ cash_balance: cash + totalCost })
    .eq('id', portfolioId);
  }

  //log transaction

  await supabase
  .from('transactions')
  .insert([{
    portfolio_id: portfolioId,
    symbol,
    transaction_type: normalizedType.toUpperCase(),
    shares,
    price_per_share: currentPrice,
    total_amount: totalCost,
    transaction_date: new Date().toISOString()
  }]);

  res.status(200).json({ message: 'Trade executed successfully' });
});

// END TRADING ENDPOINTS

// UPDATE
app.post('/api/update', async (req, res) => {
  try {
    const { data: holdings, error } = await supabase
      .from('holdings')
      .select('symbol');

    if (error) throw error;

    const symbols = [...new Set(holdings.map(h => h.symbol.toUpperCase()))];

    for (const symbol of symbols) {
      const quote = await marketData.getQuote(symbol);
      if (!quote?.regularMarketPrice) continue;

      await supabase
        .from('holdings')
        .update({ current_price: quote.regularMarketPrice })
        .eq('symbol', symbol);
    }

    res.status(200).json({ message: 'Holdings prices updated' });
  } catch (err) {
    console.error('Update error:', err.message);
    res.status(500).json({ error: 'Failed to update prices' });
  }
});

// MARKET DATA

const marketData = require('./marketData.js');
const search = require('./search.js');


// get quote for stock
app.get("/api/quote/:symbol", async (req, res) => {
  try {
    const data = await marketData.getQuote(req.params.symbol);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// get multiple quotes for stocks
app.get("/api/quotes", async (req, res) => {
  try {
    const symbolsRaw = req.query.symbols;
    if (!symbolsRaw) {
      return res.status(400).json({ error: "No symbols provided" });
    }

    const symbols = symbolsRaw.split(",").map(s => s.trim()).filter(Boolean);
    if (symbols.length === 0) {
      return res.status(400).json({ error: "No valid symbols provided" });
    }

    const data = await marketData.getMultipleQuotes(symbols);
    res.json(data);
  } catch (error) {
    console.error("Error fetching multiple quotes:", error);
    res.status(500).json({ error: "Failed to fetch quotes" });
  }
});


// get historical data for a stock
app.get("/api/historical/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const { interval = "5m", periodDays = 1 } = req.query;

  try {
    const data = await marketData.getHistoricalData(symbol, { interval, periodDays });
    res.json(data);
  } catch (error) {
    console.error("Historical data fetch error:", error);
    res.status(500).json({ error: error.message });
  }
});

//search stocks

app.get("/api/market/search", async (req, res) => {

  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query' });

  const results = search.searchStocks(q);
  res.json(results);

});




app.listen(3000, () => console.log('\x1b[32m%s\x1b[0m', 'Backend running on http://localhost:3000'));