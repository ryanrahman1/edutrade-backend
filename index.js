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
  const { email } = req.query;

  if (!email) return res.status(400).json({ erorr: 'Missing email'});

  const { data, error } = await supabase
  .from('users')
  .select('id, username, email, created_at, is_admin')
  .eq('email', email)
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

  /* For Future if username system is used
  const {data: existing, error: checkError } = await supabase
  .from('users')
  .select('id')
  .eq('username', newUsername)
  .single();

  if (existing) {
    return res.status(409).json({error: 'Username already exists' });
  }
  */

  const { error: updateError } = await supabase
  .from('users')
  .update('username', newUsername)
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

  // Respond with updated portfolio
  res.status(200).json({
    portfolio: {
      id: portfolioId,
      cash_balance: portfolio.cash_balance,
      total_value: totalValue,
      created_at: portfolio.created_at
    }
  });
});

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


// ADMIN PANEL

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

// END ADMIN PANEL

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
    const symbols = (req.query.symbols || "").split(",");
    if (!symbols.length) return res.status(400).json({ error: "No symbols provided" });
    const data = await marketData.getMultipleQuotes(symbols);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
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