import React from "react";
import SurveyTable from "./SurveyTable";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { useTheme } from "@emotion/react";
import RespondentTable from "./RespondentTable";
import DropdownWrapper from "./DropDownWrapper";
import api from '../api/axios';
import QuestionTable from "./QuestionTable";

const Dashboard = () => {
  const theme = useTheme();
  const [surveyData, setSurveyData] = React.useState(null);
  const [selectSurvey, setselectSurvey] = React.useState(null);
  const [questionData, setQuestionData] = React.useState(null);
  const [respondentData, setRespondentData] = React.useState(null);

  React.useEffect(() => {
    // Define the fetch function
    const fetchData = async () => {
      try {
        const response = await api.get('/surveys'); // Fetch data from the API
        console.log(response.data.surveys);
        setSurveyData(response.data.surveys); // Set data from the API response
      } catch (err) {
        console.log(err);
      }
    };

    // Call the fetch function
    fetchData();
  }, []);

  React.useEffect(() => {
    // Define the fetch function
    const fetchRespondentData = async () => {
      try {
        const response = await api.get(`/targets?surveyName=${selectSurvey.name}`); // Fetch data from the API
        setRespondentData(response.data); // Set data from the API response
        // setRespondentData(response.data.surveys); // Set data from the API response
      } catch (err) {
        console.log(err);
      }
    };
    const fetcQuestionData = async () => {
        try {
          const response = await api.get(`/listQuestions?surveyName=${selectSurvey.name}`); // Fetch data from the API
          setQuestionData(response.data.questions); // Set data from the API response
          // setRespondentData(response.data.surveys); // Set data from the API response
        } catch (err) {
          console.log(err);
        }
      };
    // Call the fetch function
    fetchRespondentData();
    fetcQuestionData();
  }, [selectSurvey]);

  const handleSelectRow = (childData) => {
    console.log("sdsadasdsd")
    setselectSurvey(childData);
};

  return (
    <Box
      sx={{
        marginTop: "20px",
        padding: "20px",
        marginLeft: "20%",
        marginRight: "20%",
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: "8px",
        boxShadow:
          theme.palette.mode === "light"
            ? "0 4px 8px rgba(0, 0, 0, 0.1)"
            : "0 4px 8px rgba(0, 0, 0, 0.3)",
        backgroundColor: theme.palette.background.paper, // Dynamically adjusts based on theme
      }}
    >
      <Box
        sx={{
          padding: "10px",
          borderRadius: "8px",
        }}
      >
        <DropdownWrapper label="Hide Survey Table">
        <Typography
          variant="h4"
          color="primary"
          sx={{
            fontWeight: "bold",
            marginBottom: "20px",
            borderBottom: "2px solid",
            borderColor: "primary.main",
            paddingBottom: "10px",
            width: "fit-content",
          }}
        >
          Surveys
        </Typography>
        <SurveyTable rows={surveyData} selectRow={handleSelectRow}/>
        </DropdownWrapper>
      </Box>
      <Box
        sx={{
          padding: "10px",
          borderRadius: "8px",
        }}
      >
        <DropdownWrapper label="Hide Respondent Table">
        <Typography
          variant="h4"
          color="primary"
          sx={{
            fontWeight: "bold",
            marginBottom: "20px",
            borderBottom: "2px solid",
            borderColor: "primary.main",
            paddingBottom: "10px",
            width: "fit-content",
          }}
        >
          Respondents
        </Typography>
        <RespondentTable rows={respondentData}/>
        </DropdownWrapper>
      </Box>
      <Box
        sx={{
          padding: "10px",
          borderRadius: "8px",
        }}
      >
        <DropdownWrapper label="Hide Question Table">
        <Typography
          variant="h4"
          color="primary"
          sx={{
            fontWeight: "bold",
            marginBottom: "20px",
            borderBottom: "2px solid",
            borderColor: "primary.main",
            paddingBottom: "10px",
            width: "fit-content",
          }}
        >
          Questions
        </Typography>
        <QuestionTable rows={questionData}/>
        </DropdownWrapper>
      </Box>
    </Box>
  );
};

export default Dashboard;
