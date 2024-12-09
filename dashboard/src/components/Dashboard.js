import React from "react";
import SurveyTable from "./SurveyTable";
import Typography from "@mui/material/Typography";
import { Box, Button } from "@mui/material";
import { useTheme } from "@emotion/react";
import RespondentTable from "./RespondentTable";
import AddIcon from "@mui/icons-material/Add";
import DropdownWrapper from "./DropDownWrapper";
import api from "../api/axios";
import QuestionTable from "./QuestionTable";
import CreateSurveyDialog from "./CreateSurveyDialog";
import EmailNotificationEditor from "./EmailNotificationEditor";

const Dashboard = () => {
  const theme = useTheme();
  const [surveyData, setSurveyData] = React.useState(null);
  const [selectSurvey, setselectSurvey] = React.useState(null);
  const [questionData, setQuestionData] = React.useState(null);
  const [respondentData, setRespondentData] = React.useState(null);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await api.get("/surveys");
        setSurveyData(response.data.surveys);
      } catch (err) {
        console.log(err);
      }
    };
    fetchData();
  }, []);

  React.useEffect(() => {
    const fetchRespondentData = async () => {
      try {
        if (selectSurvey) {
          const response = await api.get(
            `/targets?surveyName=${selectSurvey.name}`
          );
          setRespondentData(response.data);
        }
      } catch (err) {
        console.log(err);
      }
    };

    const fetchQuestionData = async () => {
      try {
        if (selectSurvey) {
          const response = await api.get(
            `/listQuestions?surveyName=${selectSurvey.name}`
          );
          setQuestionData(response.data.questions);
        }
      } catch (err) {
        console.log(err);
      }
    };

    if (selectSurvey) {
      fetchRespondentData();
      fetchQuestionData();
    }
  }, [selectSurvey]);

  const handleSelectRow = (childData) => {
    setselectSurvey(childData);
  };

  const handleCreateSurvey = async (surveyName) => {
    try {
      const response = await api.post("/survey", { surveyName: surveyName });
      if (response.status === 200) {
        const surveysResponse = await api.get("/surveys");
        setSurveyData(surveysResponse.data.surveys);
      }
      setCreateDialogOpen(false);
    } catch (err) {
      console.error("Failed to create survey:", err);
    }
  };

  const handleRespondentsUpdate = (updatedSurveys) => {
    setSurveyData(updatedSurveys);
  };

  const handleQuestionsUpdate = (updatedSurveys) => {
    setSurveyData(updatedSurveys);
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
        backgroundColor: theme.palette.background.paper,
      }}
    >
      <Box sx={{ padding: "10px", borderRadius: "8px", marginBottom: "40px"}}>
        <DropdownWrapper label="Hide Survey Table">
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 3,
              borderBottom: `2px solid ${theme.palette.primary.main}`,
              pb: 1,
            }}
          >
            <Typography variant="h6" color="primary" sx={{ fontWeight: "bold" }}>
              Surveys
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateDialogOpen(true)}
              size="small"
            >
              Create Survey
            </Button>
          </Box>
          <SurveyTable rows={surveyData} selectRow={handleSelectRow} />
        </DropdownWrapper>
      </Box>

      <CreateSurveyDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={handleCreateSurvey}
      />

      <Box sx={{ padding: "10px", borderRadius: "8px", marginBottom: "40px" }}>
        <DropdownWrapper label="Hide Question Table">
          <QuestionTable 
            rows={questionData} 
            surveyName={selectSurvey?.name}
            onQuestionsUpdate={handleQuestionsUpdate}
          />
        </DropdownWrapper>
      </Box>

      <Box sx={{ padding: "10px", borderRadius: "8px", marginBottom: "40px" }}>
        <DropdownWrapper label="Hide Email Notifications">
          <EmailNotificationEditor surveyId={selectSurvey?.id} />
        </DropdownWrapper>
      </Box>

      <Box sx={{ padding: "10px", borderRadius: "8px",  marginBottom: "40px" }}>
        <DropdownWrapper label="Hide Respondent Table">
          <RespondentTable
            rows={respondentData}
            surveyName={selectSurvey?.name}
            onRespondentsUpdate={handleRespondentsUpdate}
          />
        </DropdownWrapper>
      </Box>
    </Box>
  );
};

export default Dashboard;