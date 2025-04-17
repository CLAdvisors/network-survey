const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { Resend } = require('resend');
const { nanoid } = require('nanoid');
const { Pool } = require('pg');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const Papa = require('papaparse');
const dotenvFlow = require('dotenv-flow');
const bcrypt = require('bcrypt');

dotenvFlow.config();

// Create a new instance of the Pool
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: 'ONA',
});
console.log(process.env.RESEND_API_KEY)

const resend = new Resend(process.env.RESEND_KEY);

const EMAIL_HTML = [`<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<html lang="en">

  <head data-id="__react-email-head"></head>
  <div id="__react-email-preview" style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">You&#x27;re now ready to take your CLA survey!
  </div>

  <body data-id="__react-email-body" style="background-color:#f6f9fc;font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,&quot;Helvetica Neue&quot;,Ubuntu,sans-serif">
    <table align="center" width="100%" data-id="__react-email-container" role="presentation" cellSpacing="0" cellPadding="0" border="0" style="max-width:37.5em;background-color:#ffffff;margin:0 auto;padding:20px 0 48px;margin-bottom:64px">
      <tbody>
        <tr style="width:100%">
          <td>
            <table align="center" width="100%" data-id="react-email-section" style="padding:0 48px" border="0" cellPadding="0" cellSpacing="0" role="presentation">
              <tbody>
                <tr>
                  <td><img data-id="react-email-img" alt="Logo" src="https://i.postimg.cc/4nkbg08K/logo.png" width="189" height="49" style="display:block;outline:none;border:none;text-decoration:none;margin-top:1.0rem;" />
                    <hr data-id="react-email-hr" style="width:100%;border:none;border-top:1px solid #eaeaea;border-color:#e6ebf1;margin:20px 0" />`, 
                    `<a href="`, `" data-id="react-email-button" target="_blank" style="background-color:#42B4AF;border-radius:5px;color:#fff;font-size:16px;font-weight:bold;text-decoration:none;text-align:center;display:inline-block;width:100%;line-height:100%;max-width:100%;padding:10px 10px"><span><!--[if mso]><i style="letter-spacing: 10px;mso-font-width:-100%;mso-text-raise:15" hidden>&nbsp;</i><![endif]--></span><span style="max-width:100%;display:inline-block;line-height:120%;mso-padding-alt:0px;mso-text-raise:7.5px">Start your survey</span><span><!--[if mso]><i style="letter-spacing: 10px;mso-font-width:-100%" hidden>&nbsp;</i><![endif]--></span></a>
                    <hr data-id="react-email-hr" style="width:100%;border:none;border-top:1px solid #eaeaea;border-color:#e6ebf1;margin:20px 0" />
                    <p data-id="react-email-text" style="font-size:16px;line-height:24px;margin:16px 0;color:#525f7f;text-align:left">View our <a href="https://stripe.com/docs" data-id="react-email-link" target="_blank" style="color:#556cd6;text-decoration:none">privacy policy</a> .</p>
                    <p data-id="react-email-text" style="font-size:16px;line-height:24px;margin:16px 0;color:#525f7f;text-align:left">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque vel rhoncus lacus. Nulla facilisi. Donec turpis sem, dictum a sollicitudin a, faucibus ac sem. Morbi sed erat non ex mollis pulvinar ut eu nisi.</p>
                    <p data-id="react-email-text" style="font-size:16px;line-height:24px;margin:16px 0;color:#525f7f;text-align:left">— The CLA team</p>
                    <hr data-id="react-email-hr" style="width:100%;border:none;border-top:1px solid #eaeaea;border-color:#e6ebf1;margin:20px 0" />
                    <p data-id="react-email-text" style="font-size:12px;line-height:16px;margin:16px 0;color:#8898aa">Contemporary Leadership Advisors, 299 Park Ave, New York, NY 10171</p>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  </body>

</html>`];

const loremIpsum = `<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque vel rhoncus lacus. Nulla facilisi. Donec turpis sem, dictum a sollicitudin a, faucibus ac sem.</p> 
<p>Morbi sed erat non ex mollis pulvinar ut eu nisi. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed gravida cursus pellentesque. Aliquam in lectus et ex ultricies sodales a.</p>`; 

async function sendMail(email, id, surveyName, text) {
  try {
    text = "<p>" + text.replace(/"/g, '') + "</p>";
    text = text.replace(/<p>/g, '<p data-id="react-email-text" style="font-size:16px;line-height:24px;margin:16px 0;color:#525f7f;text-align:left">');
    let customLink = `${process.env.SURVEY_URL}/?surveyName=${surveyName}&userId=${id}`;

    const emailData = {
      from: 'CLA Survey <survey@cladvisors.com>',
      to: email,
      subject: 'CLA Network Survey',
      html: EMAIL_HTML[0] + text + EMAIL_HTML[1] + customLink + EMAIL_HTML[2]
    };

    // Add delay to respect rate limit
    await rateLimitedSend(emailData);

  } catch (error) {
    console.error(`Failed to send email to ${email}:`, error);
    throw error;
  }
}

// Queue for managing email sending with rate limiting
const emailQueue = [];
let isProcessing = false;
const RATE_LIMIT = 10; // emails per second
const DELAY = 1000; // 1 second delay between batches

async function rateLimitedSend(emailData) {
  // Add email to queue
  emailQueue.push(emailData);
  
  // Start processing if not already running
  if (!isProcessing) {
    isProcessing = true;
    await processEmailQueue();
  }
}

async function processEmailQueue() {
  while (emailQueue.length > 0) {
    // Process up to RATE_LIMIT emails at once
    const batch = emailQueue.splice(0, RATE_LIMIT);
    
    // Send batch of emails and track successful sends
    const results = await Promise.all(batch.map(async (emailData) => {
      try {
        await resend.emails.send(emailData);
        // Extract recipient email from emailData
        return { success: true, email: emailData.to };
      } catch (error) {
        console.error(`Failed to send email to ${emailData.to}:`, error);
        return { success: false, email: emailData.to };
      }
    }));

    // Update email_sent status for successful sends
    const successfulEmails = results.filter(r => r.success).map(r => r.email);
    if (successfulEmails.length > 0) {
      try {
        await pool.query(
          'UPDATE Respondent SET email_sent = true WHERE contact_info = ANY($1)',
          [successfulEmails]
        );
      } catch (error) {
        console.error('Failed to update email_sent status:', error);
      }
    }

    // Wait for rate limit window if more emails remain
    if (emailQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, DELAY));
    }
  }
  
  isProcessing = false;
}

// User test email function (allow admin user to send test email to themselves)
async function sendTestMail(email, surveyName, lang) {
  const client = await pool.connect();
  const query = 'SELECT text FROM email WHERE survey_name = $1 AND lang = $2';
  const values = [surveyName, lang];
  console.log(values);
  await client.query(query, values).then(response => {
    const text = response.rows[0].text;

    sendMail(email, 'demo', surveyName, text);
  });
}

async function startSurvey(surveyName){
  // Pull all users from the database
  const client = await pool.connect();
  const query = 'SELECT name, contact_info, uuid, lang FROM Respondent WHERE survey_name = $1 AND can_respond = true';
  const values = [surveyName];
  let respondents = [];
  let emails = [];
  await client.query(query, values)
    .then(response => {
        respondents = response.rows.map(row => ({
            userName: row.name,
            email: row.contact_info,
            userId: row.uuid,
            language: row.lang
        }));
    });

  // Pull the email text from the database for each language
  const emailQuery = 'SELECT lang, text FROM email WHERE survey_name = $1';
  const emailValues = [surveyName];
  await client.query(emailQuery, emailValues)
    .then(response => {
        emails = response.rows.map(row => ({
            language: row.lang,
            text: row.text
        }));
    });
    // Create a map from language to email text
    const emailMap = emails.reduce((map, email) => {
      map[email.language.replace(/"/g, "").replace(/'/g, "")] = '<p>' + email.text + '</p>';
      return map;
    }, {});
    
    // Send the emails
    respondents.forEach(respondent => {
      sendMail(respondent.email, respondent.userId, surveyName, emailMap[respondent.language].replace(/"/g, "").replace(/'/g, ""));
    });
  }
// sendMail('bgarcia2324@gmail.com', 'byVHldRI2ZgaOXNhE-ih7', 'GEEEEEE');

// Function to execute a query
async function executeQuery(query) {
  const client = await pool.connect();
  
  try {
    const result = await client.query(query);
    return result;
  } finally {
    client.release();
  }
}

const app = express();
const port = 3000; // Choose your desired port number

app.use(express.json());

app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.SURVEY_URL
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.set('trust proxy', 1);
// Session configuration with PostgreSQL
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'sessions',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'sessionId',
  cookie: {
    secure: process.env.NODE_ENV === 'prod', // Only use secure in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',  // Changed from 'strict' to 'lax' for better compatibility
    path: '/',
    domain: process.env.NODE_ENV === 'prod' ? '.bennetts.work' : undefined
  }
}));
app.post('/api/create-test-user', async (req, res) => {
  try {
    const testUser = {
      username: 'testuser',
      password: 'password123'  // Will be hashed before storage
    };

    // Hash the password
    const hashedPassword = await bcrypt.hash(testUser.password, 10);

    // Check if user exists
    const exists = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [testUser.username]
    );

    if (exists.rows.length > 0) {
      return res.json({ message: 'Test user already exists' });
    }

    // Create user
    await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2)',
      [testUser.username, hashedPassword]
    );

    res.json({ 
      message: 'Test user created',
      credentials: {
        username: testUser.username,
        password: testUser.password
      }
    });
  } catch (error) {
    console.error('Error creating test user:', error);
    res.status(500).json({ error: 'Failed to create test user' });
  }
});

// Register user endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ 
        error: 'Username and password are required' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters' 
      });
    }

    // Check if username already exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Username already exists' 
      });
    }

    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
      [username, hashedPassword]
    );

    res.status(201).json({
      success: true,
      user: {
        id: result.rows[0].id,
        username: result.rows[0].username
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      error: 'Failed to create account' 
    });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    
    const user = result.rows[0];
    
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Set session data
    req.session.userId = user.id;
    req.session.username = user.username;

    // Save session explicitly
    req.session.save(err => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Session save failed' });
      }

      // Return response after session is saved
      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username
        }
      });
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Error during logout' });
    }
    res.clearCookie('sessionId');
    res.json({ success: true });
  });
});

// Modified check-auth endpoint with better error handling
app.get('/api/check-auth', (req, res) => {

  if (!req.session) {
    return res.status(500).json({ 
      error: 'Session support not properly configured'
    });
  }

  if (req.session.userId) {
    res.json({
      isAuthenticated: true,
      user: {
        id: req.session.userId,
        username: req.session.username
      }
    });
  } else {
    res.status(401).json({ 
      isAuthenticated: false,
      message: 'No active session found'
    });
  }
});

// Auth middleware for protected routes
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};


// Example usage: Adding a new survey
async function insertSurvey(name, title) {
  const query = `INSERT INTO Survey (name, title, creation_date)
                 VALUES ('${name}', '${title}', NOW())`;
  const result = await executeQuery(query);
  
  // Handle the result as needed
  console.log('Survey added successfully!');
}
async function insertUsers(users, deleteRow = null) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // If there's a row to delete, delete it first
    if (deleteRow) {
      const deleteQuery = `
        DELETE FROM Respondent 
        WHERE name = $1 AND survey_name = $2
      `;
      await client.query(deleteQuery, [deleteRow.name, deleteRow.surveyName]);
    }

    // Then insert/update the modified rows
    for (const user of users) {
      const query = `
        INSERT INTO Respondent 
          (name, contact_info, uuid, survey_name, can_respond, lang) 
        VALUES 
          ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (name, survey_name) 
        DO UPDATE SET
          contact_info = EXCLUDED.contact_info,
          can_respond = EXCLUDED.can_respond,
          lang = EXCLUDED.lang
      `;
      
      const values = [
        user.userName,
        user.email,
        nanoid(),  // Generate new UUID for all rows
        user.surveyName,
        user.canRespond !== undefined ? user.canRespond : true, // Default to true if not specified
        user.language || 'English' // Default to English if not specified
      ];
      
      await client.query(query, values);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in database operation:', error);
    throw error;
  } finally {
    client.release();
  }
}
async function insertEmails(data) {
  // Start a PostgreSQL client from the pool
  const client = await pool.connect();
  console.log(data);
  try {
    // Begin a transaction
    await client.query('BEGIN');

    // Iterate through the emails and insert or update them
    for (const email of data) {
      const query = `
        INSERT INTO email (survey_name, lang, text)
        VALUES ($1, $2, $3)
        ON CONFLICT (survey_name, lang) DO UPDATE
        SET text = EXCLUDED.text
      `;
      const values = [email.surveyName, email.language, email.text.replace(/"/g, "").replace(/'/g, "")];
      await client.query(query, values);
    }

    // Commit the transaction
    await client.query('COMMIT');

    // Release the client back to the pool
    client.release();

    console.log('Email data inserted or updated successfully!');
  } catch (error) {
    // If an error occurs, rollback the transaction
    console.log(error);
    await client.query('ROLLBACK');
    console.error('Error inserting or updating emails:', error);
    client.release();
  }
}

async function insertQuestions(name, title, json) {
  const client = await pool.connect();

  try {
    const query = 'UPDATE Survey SET title = $1, questions = $2 WHERE name = $3';
    const values = [title, json, name];

    await client.query(query, values);

    console.log('Survey modified successfully!');
  } catch (error) {
    console.error('Error occurred:', error);
  } finally {
    await client.release();
  }
}
async function insertResponses(responses, userId) {
  const client = await pool.connect();

  try {
    const query = 'UPDATE Respondent SET response = $1 WHERE uuid = $2';
    const values = [responses, userId];

    await client.query(query, values);

    console.log('Survey modified successfully!');
  } catch (error) {
    console.error('Error occurred:', error);
  } finally {
    await client.release();
  }  
}

function csvToJson(csvString, title) {
    let json = {
        "elements": [],
        "showQuestionNumbers": false
    };

    // Parse CSV string
    let result = Papa.parse(csvString, {
        header: true,
        skipEmptyLines: true,
    });

    // Add question name validation/correction logic
    result.data.forEach((item, index) => {
      item['Question name'] = `question_${index + 1}`;
    });

    // Iterate through each parsed data and create the corresponding question object
    result.data.forEach(item => {
      console.log(item);
        let questionObject = {
            "type": item['Question type'],
            "name": item['Question name'],
            "title": item['Question title'],
            "isRequired": true,
            "choicesLazyLoadEnabled": true,
            "choicesLazyLoadPageSize": 25,
            "maxSelectedChoices": item['Max answers'] ? parseInt(item['Max answers']) : null,
         };

        json.elements.push(questionObject);
    });

    return {questions: json, title: result.data[0]['Title']};
}


// PUT API endpoint for creating a new survey
app.post('/api/survey', express.json(), (req, res) => {
  const data  = req.body;
  const surveyName = data.surveyName;

  if (!surveyName) {
    res.status(400).json({ message: 'Survey name is required.' });
    return;
  }

  // Call the function to add a new survey
  insertSurvey(surveyName, '')
  .catch(error => console.error(error))
  .then(() => {res.status(200).json({ message: 'Survey created successfully!' });});

  insertUsers([{userName: 'None', email: 'N/A', surveyName: surveyName, canRespond: false, language: 'English'}])
});

app.post('/api/testEmail', express.json(), (req, res) => {
  const data  = req.body;
  const surveyName = data.surveyName;
  const language = data.language;
  const email = data.email;

  if (!surveyName) {
    res.status(400).json({ message: 'Survey name is required.' });
    return;
  }
  if (!language) {
    res.status(400).json({ message: 'Language name is required.' });
    return;
  }
  if (!email) {
    res.status(400).json({ message: 'Email name is required.' });
    return;
  }
  console.log()
  // Call the function to add a new survey
  sendTestMail(email, surveyName, language)
  .catch(error => console.error(error))
  .then(() => {res.status(200).json({ message: 'Survey started successfully!' });});
});

app.post('/api/startSurvey', express.json(), (req, res) => {
  const data  = req.body;
  const surveyName = data.surveyName;

  if (!surveyName) {
    res.status(400).json({ message: 'Survey name is required.' });
    return;
  }

  // Call the function to add a new survey
  startSurvey(surveyName)
  .catch(error => console.error(error))
  .then(() => {res.status(200).json({ message: 'Survey started successfully!' });});
});

app.post('/api/updateEmails', express.json(), (req, res) => {
  const data  = req.body;
  const surveyName = data.surveyName;
  const csvData = data.csvData;

  if (!surveyName) {
    res.status(400).json({ message: 'Survey name is required.' });
    return;
  }

  if (!csvData) {
    res.status(400).json({ message: 'CSV data is required.' });
    return;
  }

  let csvArray = csvData.split('\n');
  const header = csvArray.shift().split(',');

  csvArray = csvArray.map((row, index) => {
    const columns = row.split(',');
    // combine all strings after index 0
    columns[1] = columns.slice(1).join(',');
    return {
      surveyName: surveyName,
      language: columns[0].replace(/(\r\n|\n|\r)/gm, ""),
      text: columns[1].replace(/(\r\n|\n|\r)/gm, "")
    }
  });

  insertEmails(csvArray);

  res.status(200).json({ message: 'Email data updated successfully.' }); 
});
// Modify the POST /api/updateTarget endpoint to handle the new fields
app.post('/api/updateTarget', async (req, res) => {
  const { csvData, surveyName, deleteRow } = req.body;

  if (!surveyName) {
    return res.status(400).json({ message: 'Survey name is required.' });
  }
  if (!csvData) {
    return res.status(400).json({ message: 'CSV data is required.' });
  }

  try {
    let csvArray = csvData.split('\n');
    const header = csvArray.shift().split(',');
    const headerDict = {};

    // Clean up header names and create dictionary
    header.forEach((name, index) => {
      const cleanName = name.replace(/(\r\n|\n|\r|")/gm, "").trim();
      headerDict[cleanName] = index;
    });

    if (csvArray.length === 0 || csvArray[0].length === 0) {
      return res.status(400).json({ message: 'CSV data is empty.' });
    }

    // Convert to json with safer column access
    const surveyTargets = csvArray
      .filter(x => x !== '')
      .map((row) => {
        const columns = row.split(',').map(col => col.replace(/(\r\n|\n|\r|")/gm, "").trim());
        
        // Safely access required columns
        const firstName = (columns[headerDict['First']] || '').trim();
        const lastName = (columns[headerDict['Last']] || '').trim();
        const email = (columns[headerDict['Email']] || '').trim();
        
        // Safely access optional columns with defaults
        const language = headerDict['Language'] !== undefined 
          ? (columns[headerDict['Language']] || 'English').trim()
          : 'English';
          
        // Check for either "Respondent" or "Can Respond" column
        const canRespond = headerDict['Respondent'] !== undefined
          ? (columns[headerDict['Respondent']] || 'true').toLowerCase() === 'true'
          : (headerDict['Can Respond'] !== undefined
              ? (columns[headerDict['Can Respond']] || 'true').toLowerCase() === 'true'
              : true);

        return {
          userName: `${firstName} ${lastName}`.trim(),
          email: email,
          language: language,
          canRespond: canRespond,
          surveyName: surveyName
        };
      })
      .filter(target => target.userName && target.email); // Filter out invalid entries

    // Validate that we have valid data
    if (surveyTargets.length === 0) {
      return res.status(400).json({ message: 'No valid respondent data found in CSV.' });
    }

    // Handle the database operations with potential deletion
    await insertUsers(surveyTargets, deleteRow);

    res.status(200).json({ 
      message: 'Respondents updated successfully.',
      updatedCount: surveyTargets.length
    });

  } catch (error) {
    console.error('Error updating respondents:', error);
    res.status(500).json({ 
      message: 'Failed to update respondents', 
      error: error.message 
    });
  }
});
// GET API endpoint for retrieving email texts and available languages
app.get('/api/survey-notifications/:surveyId', async (req, res) => {
  const surveyId = req.params.surveyId;
  if (!surveyId) {
    res.status(400).json({ message: 'Survey ID is required.' });
    return;
  }

  const client = await pool.connect();

  try {
    const query = `
      SELECT lang, text
      FROM EMAIL
      WHERE survey_name = $1
    `;

    const result = await client.query(query, [surveyId]);

    const notifications = result.rows.reduce((acc, row) => {
      acc[row.lang] = row.text;
      return acc;
    }, {});

    res.status(200).json({ notifications });
  } catch (error) {
    console.error('Error retrieving email texts:', error);
    res.status(500).json({ message: 'Failed to retrieve email texts.' });
  } finally {
    client.release();
  }
});

// Modify the POST /api/updateTargets endpoint to handle the new fields
app.post('/api/updateTargets', express.json(), (req, res) => {
  const data = req.body;
  const csvData = data.csvData;
  const surveyName = data.surveyName;

  if (!surveyName) {
    res.status(400).json({ message: 'Survey name is required.' });
    return;
  }
  if (!csvData) {
    res.status(400).json({ message: 'CSV data is required.' });
    return;
  }

  try {
    let csvArray = csvData.split('\n');
    const header = csvArray.shift().split(',');
    const headerDict = {};

    // Clean up header names and create dictionary
    header.forEach((name, index) => {
      const cleanName = name.replace(/(\r\n|\n|\r|")/gm, "").trim();
      headerDict[cleanName] = index;
    });

    if (csvArray.length === 0 || csvArray[0].length === 0) {
      res.status(400).json({ message: 'CSV data is empty.' });
      return;
    }

    // Convert to json with safer column access
    const surveyTargets = csvArray
      .filter(x => x !== '')
      .map((row) => {
        const columns = row.split(',').map(col => col.replace(/(\r\n|\n|\r|")/gm, "").trim());
        
        // Safely access required columns
        const firstName = (columns[headerDict['First']] || '').trim();
        const lastName = (columns[headerDict['Last']] || '').trim();
        const email = (columns[headerDict['Email']] || '').trim();
        
        // Safely access optional columns with defaults
        const language = headerDict['Language'] !== undefined 
          ? (columns[headerDict['Language']] || 'English').trim()
          : 'English';
          
        // Check for either "Respondent" or "Can Respond" column
        const canRespond = headerDict['Respondent'] !== undefined
          ? (columns[headerDict['Respondent']] || 'true').toLowerCase() === 'true'
          : (headerDict['Can Respond'] !== undefined
              ? (columns[headerDict['Can Respond']] || 'true').toLowerCase() === 'true'
              : true);

        return {
          userName: `${firstName} ${lastName}`.trim(),
          email: email,
          language: language,
          canRespond: canRespond,
          surveyName: surveyName
        };
      })
      .filter(target => target.userName && target.email); // Filter out invalid entries

    // Validate that we have valid data
    if (surveyTargets.length === 0) {
      res.status(400).json({ message: 'No valid respondent data found in CSV.' });
      return;
    }

    // Insert the users into the database
    insertUsers(surveyTargets);

    res.status(200).json({ 
      message: 'Survey created successfully.',
      processedCount: surveyTargets.length
    }); 

  } catch (error) {
    console.error('Error processing CSV:', error);
    res.status(500).json({ 
      message: 'Failed to process CSV data',
      error: error.message
    });
  }
});

// PUT API endpoint for uploading a json file of questions
app.post('/api/updateQuestions', express.json(), (req, res) => {
  const data  = req.body;
  const surveyQuestions = data.questions;
  const surveyName = data.surveyName;

  // Debug logging
  console.log('updateQuestions typeof:', typeof surveyQuestions);
  console.log('updateQuestions value:', JSON.stringify(surveyQuestions));

  let surveyData;
  if (typeof surveyQuestions === 'string') {
    // CSV format
    surveyData = csvToJson(surveyQuestions);
    insertQuestions(surveyName, surveyData.title, surveyData.questions);
  } else if (typeof surveyQuestions === 'object' && surveyQuestions !== null) {
    // JSON format (SurveyJS)
    insertQuestions(surveyName, '', surveyQuestions);
  } else {
    return res.status(400).json({ message: 'Invalid questions format.' });
  }

  res.status(200).json({ message: 'Questions created successfully.' });
});

// PUT API endpoint for answer submission
app.post('/api/user', express.json(), (req, res) => {
    const data  = req.body;
    const userId  = data.userId;
    const surveyName = data.surveyName;
    const answers = JSON.parse(data.answers);
    const answerTimeStamp = new Date().toLocaleString();
    // add time stamp to answers
    answers.timeStamp = answerTimeStamp; 

    // NEW DB CODE
    insertResponses(answers, userId);

});

// GET API endpoint for lazy loading the names list
app.get('/api/names', async (req, res) => {
  const { skip = 0, take = 10, filter = '', surveyName = '', userId = '' } = req.query;

  const client = await pool.connect();
  
  try {
    // Modified query to exclude the current user based on UUID
    const query = `
      SELECT r.name, r.contact_info
      FROM Respondent r
      JOIN Survey s ON r.survey_name = s.name
      WHERE s.name = $1
      AND r.uuid != $2
      AND (r.name ILIKE $3 OR r.contact_info ILIKE $3)
      ORDER BY r.name
      OFFSET $4
      LIMIT $5;
    `;

    const values = [surveyName, userId, `%${filter}%`, skip, take];
    const result = await client.query(query, values);

    const filteredNames = result.rows.map(user => 
      `${user.name} (${user.contact_info})`
    );

    res.status(200).json({
      names: filteredNames,
      total: filteredNames.length
    });

  } catch (error) {
    console.error('Error fetching names:', error);
    res.status(500).json({ 
      error: 'Failed to fetch names',
      message: error.message 
    });
  } finally {
    client.release();
  }
});

// GET API list questions for dashboard
app.get('/api/listQuestions', async (req, res) => {
  const { surveyName = '' } = req.query;

  if(surveyName === '' || surveyName === 'undefined' || surveyName === null || surveyName === 'null') {
    res.status(404).json({ message: 'Survey name not found.' });
    return;
  }

  // NEW DB CODE
  const client = await pool.connect();

  const query = `
  SELECT questions, title
  FROM Survey
  WHERE name = $1;
  `;

  const values = [surveyName];

  // Query the database for json question data
  client.query(query, values)
    .then(result => {
      const questions = result.rows[0]?.questions?.elements?.map((q, index) => ({
        id: q.name.replace('question_', ''),
        text: q.title,
        type: q.type,
        required: q.isRequired,
        max: q.maxSelectedChoices ? q.maxSelectedChoices : null,
      })) || [];
      res.status(200).json({ questions });
    })
    .catch(error => {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch questions' });
    })
    .finally(() => {
      client.release();

  });
});


// GET API endpoint for survey questions
app.get('/api/questions', async (req, res) => {
  const { surveyName = '' } = req.query;

  if(surveyName === '' || surveyName === 'undefined' || surveyName === null || surveyName === 'null') {
    res.status(404).json({ message: 'Survey name not found.' });
    return;
  }

  // NEW DB CODE
  const client = await pool.connect();

  const query = `
  SELECT questions, title
  FROM Survey
  WHERE name = $1;
  `;

  const values = [surveyName];

  client.query(query, values)
    .then(result => {
      const jsonData = {title: result.rows[0].title, questions: result.rows[0].questions};
      // Process the returned JSON data
      res.status(200).json(jsonData);
    })
    .catch(error => {
      // Handle the error
      console.error(error);
    })
    .finally(() => client.release());

  });

// GET API endpoint for survey results
app.get('/api/results', async (req, res) => {
  const { surveyName = '' } = req.query;
  

  // NEW DB CODE
  const client = await pool.connect();
  

  const query = 'SELECT name, can_respond, response FROM Respondent WHERE survey_name = $1';
  const values = [surveyName];
  client.query(query, values)
    .then(response => {
        const responses = response.rows.reduce((combined, row) => {
          if (row.response === null) return combined;
          return {...combined, [row.name]: row.response};
        }, {});
        const users = response.rows.map(row => {
          return {name: row.name, isRespondent: row.can_respond}
        });
        console.log(users);
        res.status(200).json({responses, users});
    })
    .catch(e => console.error(e.stack))
    .finally(() => client.release());

});

// GET API endpoint for a list of survey targets and the status of their responses
app.get('/api/targets', async(req, res) => {
  const { surveyName = '' } = req.query;

  const client = await pool.connect();

  const query = `SELECT name, contact_info, respondent_id, can_respond, lang, response IS NULL AS response_status 
               FROM Respondent 
               WHERE survey_name = $1`;
  client.query(query, [surveyName])
    .then(response => {
        const respondents = response.rows.map((row, index) => ({
            id: row.respondent_id,
            name: row.name,
            email: row.contact_info,
            language: row.lang,
            canRespond: row.can_respond,
            status: row.response_status ? 'Incomplete' : 'Complete'
        }));
        res.status(200).json(respondents);
    })
    .catch(e => console.error(e.stack))
    .finally(() => client.release());
});

// GET API endpoint for a list of current surveys
app.get('/api/surveys', requireAuth, async (req, res) => {
  // NEW DB CODE
  const client = await pool.connect();

  const query = `
  SELECT 
    s.name,
    s.creation_date,
    COUNT(r.respondent_id) AS number_of_respondents,
    jsonb_array_length(s.questions->'elements') AS number_of_questions
FROM 
    Survey s
LEFT JOIN 
    Respondent r ON s.name = r.survey_name
GROUP BY 
    s.name, s.creation_date, s.questions;
  `;

  client.query(query)
    .then(result => {
      const surveys = result.rows.map((row, index) => ({
        id: index + 1,
        name: row.name,
        respondents: row.number_of_respondents - 1 + "",
        questions: row.number_of_questions + "",
        date: row.creation_date,
      }));
      // Process the returned JSON data
      res.status(200).json({ surveys });
    })
    .catch(error => {
      // Handle the error
      console.error(error);
    })
    .finally(() => client.release());
});

// GET API endpoint for status of survey creation
app.get('/api/surveyStatus', async (req, res) => {
  const { surveyName = '' } = req.query;

  if(surveyName === '' || surveyName === 'undefined' || surveyName === null || surveyName === 'null') {
    res.status(404).json({ message: 'Survey name not found.' });
    return;
  }
  const client = await pool.connect();

  // NEW DB CODE
  const query = `
  SELECT 
  s.name AS survey_name, 
  COUNT(r.respondent_id) AS number_of_respondents, 
  (s.questions IS NULL) AS is_questions_null
FROM 
  Survey s
LEFT JOIN 
  Respondent r ON s.name = r.survey_name
WHERE 
  s.name = $1
GROUP BY 
  s.name, s.questions;
  `;


  const values = [surveyName];

  client.query(query, values)
    .then(result => {
      const { number_of_respondents, is_questions_null } = result.rows[0];
      // Process the returned values
      res.status(200).json( {
        userDataStatus: number_of_respondents >  1 ? true : false,
        questionDataStatus: !is_questions_null
      });
    })
    .catch(error => {
      // Handle the error
      console.error(error);
    })
    .finally(() => client.release());

});


// Delete survey endpoint
app.delete('/api/survey/:surveyName', requireAuth, async (req, res) => {
  const surveyName = req.params.surveyName;
  console.log("surveyName", surveyName);
  if (!surveyName) {
    return res.status(400).json({ message: 'Survey name is required.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete related records first due to foreign key constraints
    await client.query('DELETE FROM email WHERE survey_name = $1', [surveyName]);
    await client.query('DELETE FROM respondent WHERE survey_name = $1', [surveyName]);
    
    // Delete the survey
    const result = await client.query('DELETE FROM survey WHERE name = $1 RETURNING name', [surveyName]);
    
    await client.query('COMMIT');

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    res.status(200).json({ 
      message: 'Survey and all related data deleted successfully.',
      deletedSurvey: result.rows[0].name
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting survey:', error);
    res.status(500).json({ 
      message: 'Failed to delete survey', 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// Delete user endpoint
app.delete('/api/user', requireAuth, async (req, res) => {
  const { userName, surveyName } = req.body;
  console.log("userName", userName);
  console.log("surveyName", surveyName);

  if (!userName || !surveyName) {
    return res.status(400).json({ 
      message: 'Both user name and survey name are required.' 
    });
  }

  const client = await pool.connect();

  try {
    const result = await client.query(
      'DELETE FROM respondent WHERE name = $1 AND survey_name = $2 RETURNING name, survey_name',
      [userName, surveyName]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ 
        message: 'User not found in the specified survey.' 
      });
    }

    res.status(200).json({
      message: 'User deleted successfully from survey.',
      deletedUser: result.rows[0]
    });

  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ 
      message: 'Failed to delete user', 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// Delete question endpoint
app.delete('/api/question', requireAuth, async (req, res) => {
  const { questionName, surveyName } = req.body;

  if (!questionName || !surveyName) {
    return res.status(400).json({ 
      message: 'Both question name and survey name are required.' 
    });
  }

  const client = await pool.connect();

  try {
    // First, get the current questions
    const surveyResult = await client.query(
      'SELECT questions FROM survey WHERE name = $1',
      [surveyName]
    );

    if (surveyResult.rowCount === 0) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    const questions = surveyResult.rows[0].questions;
    
    // Find and remove the question
    const questionIndex = questions.elements.findIndex(q => q.name === questionName);
    
    if (questionIndex === -1) {
      return res.status(404).json({ message: 'Question not found in survey.' });
    }

    // Remove the question
    questions.elements.splice(questionIndex, 1);

    // Update the survey with the modified questions
    const updateResult = await client.query(
      'UPDATE survey SET questions = $1 WHERE name = $2 RETURNING name',
      [questions, surveyName]
    );

    res.status(200).json({
      message: 'Question deleted successfully.',
      surveyName: updateResult.rows[0].name,
      deletedQuestion: questionName
    });

  } catch (error) {
    console.error('Error deleting question:', error);
    res.status(500).json({ 
      message: 'Failed to delete question', 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

app.get('/', async (req, res) => {
  res.status(200).json({ message: 'Health Check: All Good!.' });
});


// Start the server
app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});