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

const resend = new Resend('re_UNs8VgH6_HhcK6GEjQM7pk3BczHt9dKB3');

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
                  <td><img data-id="react-email-img" alt="Logo" src="https://i.postimg.cc/4nkbg08K/logo.png" width="189" height="49" style="display:block;outline:none;border:none;text-decoration:none" />
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
    text = text.replace(/<p>/g, '<p data-id="react-email-text" style="font-size:16px;line-height:24px;margin:16px 0;color:#525f7f;text-align:left">');

    let customLink = `https://survey.bennetts.work/?surveyName=${surveyName}&userId=${id}`;
    const data = await resend.emails.send({
      from: 'CLA Survey <survey@cladvisors.com>',
      to: email,
      subject: 'CLA Network Survey',
      html: EMAIL_HTML[0] + text + EMAIL_HTML[1] + customLink + EMAIL_HTML[2]
    });
  } catch (error) {
    console.error(error);
  }
}

// User test email function (allow admin user to send test email to themselves)
async function sendTestMail(email, surveyName, lang) {
  const client = await pool.connect();
  const query = 'SELECT text FROM email WHERE survey_name = $1 AND lang = $2';
  const values = [surveyName, lang];

  await client.query(query, values).then(response => {
    const text = response.rows[0].text;

    sendMail(email, 'demo', surveyName, text);
  });
}

async function startSurvey(surveyName){
  // Pull all users from the database
  const client = await pool.connect();
  const query = 'SELECT name, contact_info, uuid, lang FROM Respondent WHERE survey_name = $1';
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
  console.log('Session data:', req.session);
  console.log('Cookies:', req.headers.cookie);

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
        user.respondent || true,
        user.language || 'en'
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

  try {
    // Begin a transaction
    await client.query('BEGIN');

    // Iterate through the users and insert them
    for (const email of data) {
      const query = 'INSERT INTO email (survey_name, lang, text) VALUES ($1, $2, $3)';
      const values = [email.surveyName, email.language, email.text];
      await client.query(query, values);
    }

    // Commit the transaction
    await client.query('COMMIT');

    // Release the client back to the pool
    client.release();

    console.log('Email data inserted successfully!');
  } catch (error) {
    // If an error occurs, rollback the transaction
    console.log(error)
    await client.query('ROLLBACK');
    console.error('Error inserting users:', error);
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

    // Iterate through each parsed data and create the corresponding question object
    result.data.forEach(item => {
        let questionObject = {
            "type": item['Question type'],
            "name": item['Question name'],
            "title": item['Question title'],
            "isRequired": true,
            "choicesLazyLoadEnabled": true,
            "choicesLazyLoadPageSize": 25
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
// PUT API endpoint for updating targets
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

    header.forEach((name, index) => {
      headerDict[name.replace(/(\r\n|\n|\r)/gm, "")] = index;
    });

    if (csvArray.length === 0 || csvArray[0].length === 0) {
      return res.status(400).json({ message: 'CSV data is empty.' });
    }

    // Convert to json
    const surveyTargets = csvArray.filter(x => x !== '').map(row => {
      const columns = row.split(',');
      return {
        userName: columns[headerDict['First']].replace(/(\r\n|\n|\r)/gm, "") + " " + 
                 columns[headerDict['Last']].replace(/(\r\n|\n|\r)/gm, ""),
        email: columns[headerDict['Email']].replace(/(\r\n|\n|\r)/gm, ""),
        respondent: true,
        language: 'en',
        surveyName: surveyName
      };
    });

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

// PUT API endpoint for uploading a csv file of names
app.post('/api/updateTargets', express.json(), (req, res) => {
  const data  = req.body;
  const csvData = data.csvData;
  const surveyName = data.surveyName;
  console.log("DATA:", data);

  if (!surveyName) {
    res.status(400).json({ message: 'Survey name is required.' });
    return;
  }
  if (!csvData ) {
    res.status(400).json({ message: 'CSV data is required.' });
    return;
  }
  console.log(csvData);
  let csvArray = csvData.split('\n');
  const header = csvArray.shift().split(',');
  const headerDict = {};

  header.forEach((name, index) => {
    headerDict[name.replace(/(\r\n|\n|\r)/gm, "")] = index;
  });
  console.log("csv " + csvArray);
  if (csvArray.length === 0 || csvArray[0].length === 0) {
    res.status(400).json({ message: 'CSV data is empty.' });
    return;
  }
  // Convert to json
  const surveyTargets = csvArray.filter(x => x !== '').map((row, index) => {
    const columns = row.split(',');
    return {
      userName: columns[headerDict['First']].replace(/(\r\n|\n|\r)/gm, "") + " " + columns[headerDict['Last']].replace(/(\r\n|\n|\r)/gm, ""),
      firstName: columns[headerDict['First']].replace(/(\r\n|\n|\r)/gm, ""),
      lastName: columns[headerDict['Last']].replace(/(\r\n|\n|\r)/gm, ""),
      email: columns[headerDict['Email']].replace(/(\r\n|\n|\r)/gm, ""),
      respondent: columns[headerDict['Respondent']].replace(/(\r\n|\n|\r)/gm, ""),
      location: columns[headerDict['Location']].replace(/(\r\n|\n|\r)/gm, ""),
      level: columns[headerDict['Level']].replace(/(\r\n|\n|\r)/gm, ""),
      gender: columns[headerDict['Gender']].replace(/(\r\n|\n|\r)/gm, ""),
      race: columns[headerDict['Race']].replace(/(\r\n|\n|\r)/gm, ""),
      manager: columns[headerDict['Manager']].replace(/(\r\n|\n|\r)/gm, ""),
      vp:columns[headerDict['VP']].replace(/(\r\n|\n|\r)/gm, ""),
      businessGroup:columns[headerDict['Business Group']].replace(/(\r\n|\n|\r)/gm, ""),
      businessGroup1:columns[headerDict['Business Group - 1']].replace(/(\r\n|\n|\r)/gm, ""),
      businessGroup2:columns[headerDict['Business Group - 2']].replace(/(\r\n|\n|\r)/gm, ""),
      language:columns[headerDict['Language']].replace(/(\r\n|\n|\r)/gm, ""),
      userId: nanoid(),
      surveyName: surveyName,
      answers: []
    }
  });
  // NEW DB CODE
  // Insert the users into the database
  insertUsers(surveyTargets);

  // make this a promise response
  res.status(200).json({ message: 'Survey created successfully.' }); 
});

// PUT API endpoint for uploading a json file of questions
app.post('/api/updateQuestions', express.json(), (req, res) => {
  const data  = req.body;
  const surveyQuestions = data.questions;
  const surveyName = data.surveyName;
  // move to another endpoint
  console.log("SURVEY QUESTIONS:", surveyQuestions);
  const surveyData = csvToJson(surveyQuestions);

  console.log("DATA:", data);
  // NEW DB CODE
  insertQuestions(surveyName, surveyData.title, surveyData.questions);

  //TODO add proper repsonse handling
  res.status(200).json({ message: 'Questions created successfully.' });
  
});

// PUT API endpoint for answer submission
app.post('/api/user', express.json(), (req, res) => {
    const data  = req.body;
    console.log(data);
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
  const { skip = 0, take = 10, filter = '', surveyName = '' } = req.query;

  console.log("skip:", skip, "take:", take, "filter:", filter, "surveyName:", surveyName);
  // NEW DB CODE
    
  const client = await pool.connect();
  
  const query = `
  SELECT r.name, r.contact_info
  FROM Respondent r
  JOIN Survey s ON r.survey_name = s.name
  WHERE s.name = $1
  AND (r.name ILIKE $2 OR r.contact_info ILIKE $2)
  OFFSET $3
  LIMIT $4;
  `;

  const values = [surveyName, `%${filter}%`, skip, take];
  client.query(query, values)
  .then(result => {
    const users = result.rows;
    // Process the returned users
    filteredNames = [];
    // iterate over name, contact_info pairs
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      // add to response
      filteredNames.push(user.name + " (" + user.contact_info + ")");
    }
    const response = {
      names: filteredNames,
      //TODO check that this length/total even works
      total: filteredNames.length
    };
    console.log("RESPONSE:", response);
    res.status(200).json(response);
  })
  .catch(error => {
    // Handle the error
    console.error(error);
  });
  client.release();
  
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
        id: index + 1,
        text: q.title,
        type: q.type,
        required: q.isRequired
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
  
  const query = 'SELECT name, response FROM Respondent WHERE survey_name = $1';
  const values = [surveyName];
  client.query(query, values)
    .then(response => {
        const responses = response.rows.reduce((combined, row) => {
          if (row.response === null) return combined;
          return {...combined, [row.name]: row.response};
        }, {});
        console.log(responses); // This will be an array of response JSON objects
        res.status(200).json({responses});
    })
    .catch(e => console.error(e.stack))
    .finally(() => client.release());

});

// GET API endpoint for a list of survey targets and the status of their responses
app.get('/api/targets', async(req, res) => {
  const { surveyName = '' } = req.query;
  console.log("Survey name!!!:  " + surveyName)

  // NEW DB CODE
  const client = await pool.connect();

  const query = `SELECT name, contact_info, respondent_id, response IS NULL AS response_status 
               FROM Respondent 
               WHERE survey_name = $1`;
  client.query(query, [surveyName])
    .then(response => {
        const respondents = response.rows.map((row, index) => ({
            id: row.respondent_id,
            name: row.name,
            email: row.contact_info,
            status: row.response_status ? 'Incomplete' : 'Complete'
        }));
        console.log(respondents);
        res.status(200).json(respondents); // This will be an array of respondent objects
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
        respondents: row.number_of_respondents + "",
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
      console.log(number_of_respondents, is_questions_null)
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

app.get('/', async (req, res) => {
  res.status(200).json({ message: 'Health Check: All Good!.' });
});


// Start the server
app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});