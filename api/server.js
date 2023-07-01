const express = require('express');
const fs = require('fs');
const cors = require('cors');
const { nanoid } = require('nanoid');
const { Pool } = require('pg');

// Create a new instance of the Pool
const pool = new Pool({
  user: 'postgres',
  password: 'Picker22',
  host: 'database-1.co6wn5j0nqtw.us-east-2.rds.amazonaws.com',
  port: '5432',
  database: '',
});

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

// TODO for MVP
// - move to a database to store survey data
// - extend the create survey backend
// -- handle json file upload
// -- handle xlsx entry
// - add authentication
// - add email functionality
// - add csv file download

app.use(cors()); // Enable CORS



// Example usage: Adding a new survey
async function insertSurvey(name, title) {
  const query = `INSERT INTO Survey (name, title, creation_date)
                 VALUES ('${name}', '${title}', NOW())`;
  const result = await executeQuery(query);
  
  // Handle the result as needed
  console.log('Survey added successfully!');
}
async function insertUsers(users) {
  // Start a PostgreSQL client from the pool
  const client = await pool.connect();

  try {
    // Begin a transaction
    await client.query('BEGIN');

    // Iterate through the users and insert them
    for (const user of users) {
      const query = 'INSERT INTO Respondent (name, contact_info, uuid, survey_name, can_respond) VALUES ($1, $2, $3, $4, $5)';
      const values = [user.userName, user.email, user.userId, user.surveyName, user.respondent];
      await client.query(query, values);
    }

    // Commit the transaction
    await client.query('COMMIT');

    // Release the client back to the pool
    client.release();

    console.log('Users inserted successfully!');
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
    await client.end();
  }
}
async function insertResponses(responses, surveyName, userId) {
  const client = await pool.connect();

  try {
    // Begin a transaction
    await client.query('BEGIN');

    for (const response of responses) {
      const query = 'INSERT INTO Response (respondent_id, survey_name, response_value, response_timestamp) VALUES ($1, $2, $3, $4, $5)';
      const values = [userId, surveyName, response, new Date().toLocaleString()];
      await client.query(query, values);
    }

    // Commit the transaction
    await client.query('COMMIT');

    // Release the client back to the pool
    client.release();

    console.log('Responses inserted successfully!');
  } catch (error) {
    // If an error occurs, rollback the transaction
    console.log(error)
    await client.query('ROLLBACK');
    console.error('Error inserting responses:', error);
    client.release();
  }
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
  .catch(error => console.error(error));

  // OLD FS CODE
  let error = false;

  const surveyUserDataFile = `data/userdata_${surveyName}.json`;
  // Create a json object for each user in the surveyTargets array
  fs.writeFile(surveyUserDataFile, '', err => 
  {  
    if (err){
      console.error('Error writing user data file:', err); 
      error = true;
    }
  });
  const surveyNamesFile = `data/names_${surveyName}.json`;
  fs.writeFile(surveyNamesFile, '', err => 
  {  
    if (err){
      console.error('Error reading name data file:', err); 
      error = true;
    }
  });
  const surveyQuestionsFile = `data/json_${surveyName}.json`;
  fs.writeFile(surveyQuestionsFile, '', err =>
  {
    if (err){
      console.error('Error reading question data file:', err); 
      error = true;
    }
  });

  if (error) {
    res.status(500).json({ message: 'Error creating survey.' });
  } else {
    res.status(200).json({ message: 'Survey created successfully.' });
  }
});

// PUT API endpoint for uploading a csv file of names
app.post('/api/updateTargets', express.json(), (req, res) => {
  const data  = req.body;
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

  // OLD FS CODE
  console.log("Updating targets for survey: " + surveyName);
  console.log(data);
  
  // Remove the header from the csv string, create a dict from header name to index
  let csvArray = csvData.split('\n');
  const header = csvArray.shift().split(',');
  const headerDict = {};

  header.forEach((name, index) => {
    headerDict[name.replace(/(\r\n|\n|\r)/gm, "")] = index;
  });
  console.log(headerDict);
  // Convert to json
  const surveyTargets = csvArray.map((row, index) => {
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
      userId: nanoid(),
      surveyName: surveyName,
      answers: []
    }
  });

  // NEW DB CODE
  // Insert the users into the database
  console.log("GUHHHH")
  insertUsers(surveyTargets);

  // OLD FS CODE
  let error = false;

  // Write the user data to the file
  const surveyUserDataFile = `data/userdata_${surveyName}.json`;
  fs.writeFile(surveyUserDataFile, JSON.stringify(surveyTargets, null, 2), err => 
  {  
    if (err){
      console.error('Error writing user data file:', err); 
      error = true;
    }
  });

  // generate names file from surveyTargets
  const surveyNamesFile = `data/names_${surveyName}.json`;

  // Create an array of names from the surveyTargets
  const names = [];
  surveyTargets.forEach((user, index) => {
    names.push(user.userName + " (" + user.email + ")");
  });
  // Write the names to the file
  fs.writeFile(surveyNamesFile, JSON.stringify(names, null, 2), err =>
  {
    if (err){
      console.error('Error reading name data file:', err);
      error = true;
    }
  });

  if (error) {
    res.status(500).json({ message: 'Error creating survey.' });
  } else {
    res.json({ message: 'Survey created successfully.' });
  }
});

// PUT API endpoint for uploading a json file of questions
app.post('/api/updateQuestions', express.json(), (req, res) => {
  const data  = req.body;
  const surveyQuestions = data.surveyQuestions;
  const surveyName = data.surveyName;
  // move to another endpoint
  const surveyTitle = data.surveyTitle;

  console.log("DATA:", data);
  // NEW DB CODE
  insertQuestions(surveyName, surveyTitle, surveyQuestions);

  // OLD FS CODE
  let error = false;

  console.log("Updating questions for survey: " + surveyName);

  const surveyQuestionsFile = `data/json_${surveyName}.json`;

  const jsonData = {title: surveyTitle, questions: surveyQuestions};
  fs.writeFile(surveyQuestionsFile, JSON.stringify(jsonData, null, 2), err => {
    if (err) {
      console.error('Error creating survey:', err);
      res.status(500).json({ message: 'Error creating survey.' });
    } else {
      res.json({ message: 'Survey created successfully.' });
    }
  });

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
    insertResponses(answers, surveyName, userId);

    // OLD FS CODE
    const userDataFile = `data/userdata_${surveyName}.json`;

    // Perform desired operations with the received data
    console.log('Received user ID:', userId);
    console.log('Received data:', answers);
  
    // Read existing user data 
    let existingUserData = [];
    try {
        existingUserData = JSON.parse(fs.readFileSync(userDataFile));
    } catch (error) {
        console.error('Error reading user data file:', error);
    }

    const existingUserIndex = existingUserData.findIndex(user => user.userId === userId);

    if (existingUserIndex !== -1) {
        // Update existing user data
        existingUserData[existingUserIndex].answers = answers;
    } else {
        // Error if user ID is not found
        console.error('User ID not found:', userId);
    }

    // Write updated user data to the JSON file
    fs.writeFile(userDataFile, JSON.stringify(existingUserData, null, 2), err => {
        if (err) {
        console.error('Error writing user data file:', err);
        res.status(500).json({ message: 'Error writing user data.' });
        } else {
        console.log('User data written to file:', userDataFile);
        res.json({ message: 'User data received and saved successfully.' });
        }
    });

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
    res.json(response);
  })
  .catch(error => {
    // Handle the error
    console.error(error);
  });
  client.release();
  // OLD FS CODE
  // const namesData = JSON.parse(fs.readFileSync(`data/names_${surveyName}.json`));

  // let filteredNames = namesData.filter(name => name.toLowerCase().includes(filter.toLowerCase()));

  // filteredNames = filteredNames.slice(skip, parseInt(skip) + parseInt(take));

  // const response = {
  //   names: filteredNames,
  //   //TODO check that this length/total even works
  //   total: filteredNames.length
  // };

  // res.json(response);
});

// GET API endpoint for survey questions
app.get('/api/questions', (req, res) => {
  const { surveyName = '' } = req.query;

  const questionsData = JSON.parse(fs.readFileSync(`data/json_${surveyName}.json`));

  res.json(questionsData);

});

// GET API endpoint for survey results
app.get('/api/results', (req, res) => {
  const { surveyName = '' } = req.query;
  
  const userData = JSON.parse(fs.readFileSync(`data/userdata_${surveyName}.json`));

  // send the response if the user data file exists
  if (userData) {
    res.json(userData);
  } else {
    res.status(404).json({ message: 'User data not found.' });
  }
});

// GET API endpoint for a list of survey targets and the status of their responses
app.get('/api/targets', (req, res) => {
  const { surveyName = '' } = req.query;
  console.log("Survey name: " + surveyName)

  // catch if file is empty
  if (fs.readFileSync(`data/userdata_${surveyName}.json`) == "") {
    res.status(404).json({ message: 'User data empty.' });
    return;
  }
  const userData = JSON.parse(fs.readFileSync(`data/userdata_${surveyName}.json`));

  // send the response if the user data file exists
  if (userData) {
    const targets = userData.map(user => {
      return {
        userName: user.userName,
        Email: user.email,
        started: Object.keys(user.answers).length > 0 ? user.answers.timeStamp : '',
        status: Object.keys(user.answers).length > 0 ? 'Completed' : 'Pending'
      }
    }); 
    res.json(targets);
  } else {
    res.status(404).json({ message: 'User data not found.' });
  }
});

// GET API endpoint for a list of current surveys
app.get('/api/surveys', (req, res) => {
  const surveys = fs.readdirSync('./data').filter(file => file.startsWith('json_')).map(file => file.replace('json_', '').replace('.json', ''));
  console.log(surveys)
  // For each survey name in the json array of survey names, check if the associated json userdata and names files have data inside them.
  // Create a new object with the survey name and a boolean value for whether or not the survey is complete.


  res.json({surveys: surveys});
});

// GET API endpoint for status of survey creation
app.get('/api/surveyStatus', (req, res) => {
  const { surveyName = '' } = req.query;

  if(surveyName === '' || surveyName === 'undefined' || surveyName === null || surveyName === 'null') {
    res.status(404).json({ message: 'Survey name not found.' });
    return;
  }
  const userData = fs.readFileSync(`data/userdata_${surveyName}.json`);
  const questionData = fs.readFileSync(`data/json_${surveyName}.json`);
  console.log("Survey status request: " + surveyName);
  res.json( {
    // Currently 12 to catch if file contians 'null' or 'undefined'
    userDataStatus: userData.length >  12 ? true : false,
    questionDataStatus: questionData.length > 12 ? true : false
  });
});


// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});