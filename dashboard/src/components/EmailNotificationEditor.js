import React, { useState, useEffect } from "react";
import {
  Box,
  TextField,
  Autocomplete,
  Paper,
  Typography,
  Button,
  Alert,
  Collapse,
  IconButton,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import EditableTableWrapper from "./EditableTableWrapper";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import api from "../api/axios";
const HEADER = "Language,Text\n";
const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "ru", label: "Russian" },
  { code: "ja", label: "Japanese" },
  { code: "zh", label: "Chinese" },
  { code: "ko", label: "Korean" },
];

const EmailNotificationEditor = ({ surveyId }) => {
  const theme = useTheme();
  const [selectedLanguage, setSelectedLanguage] = useState(null);
  const [notificationText, setNotificationText] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [notifications, setNotifications] = useState({});
  const [alert, setAlert] = useState({
    show: false,
    type: "info",
    message: "",
  });

  const handleCloseAlert = () => {
    setAlert({ ...alert, show: false });
  };

  // Fetch notifications for the survey
  useEffect(() => {
    const fetchNotifications = async () => {
        try {
          const response = await api.get(`/survey-notifications/${surveyId}`);
          setNotifications(response.data.notifications);
    
        //   set available languages to all languages
          const availableLanguages  = LANGUAGES.map((lang) => { return lang.label; });
          if (Object.keys(response.data.notifications).length > 0) {
            const firstLanguageCode = availableLanguages[0];
            const firstLanguage = LANGUAGES.find(
              (lang) => lang.label === firstLanguageCode
            );
    
            if (firstLanguage) {
              setSelectedLanguage(firstLanguage);
              setNotificationText(response.data.notifications[firstLanguageCode].replace(/"/g, ''));
              setOriginalText(response.data.notifications[firstLanguageCode]);
            } else {
              setSelectedLanguage(null);
              setNotificationText("");
              setOriginalText("");
            }
          } else {
            setSelectedLanguage({ code: "en", label: "English" });
            setNotificationText("");
            setOriginalText("");
          }
        } catch (error) {
          console.error("Failed to fetch notifications:", error);
          setAlert({
            show: true,
            type: "error",
            message: "Failed to load notifications",
          });
        }
      };
    if (surveyId) {
      fetchNotifications();
    }
  }, [surveyId]);

  // Update the notification text and original text when the selected language changes
  useEffect(() => {
    console.log(notifications)
    if (selectedLanguage && notifications[selectedLanguage.label]) {
      setNotificationText(notifications[selectedLanguage.label].replace(/"/g, '') || "");
      setOriginalText(notifications[selectedLanguage.label] || "");
    } else {
        setNotificationText("");
      setOriginalText("");
    }
  }, [selectedLanguage, notifications, surveyId]);

  const handleLanguageChange = (event, newValue) => {
    if (newValue) {
      setSelectedLanguage(newValue);
    }
  };

  const handleTextChange = (event) => {
    const newText = event.target.value;
    setNotificationText(newText);
    setHasChanges(newText !== originalText);
  };

  const handleSave = async () => {
    try {
    const csvData = HEADER + LANGUAGES.map(lang => {
        const text = lang.label === selectedLanguage.label ? `"${notificationText.replace(/"/g, '""')}"` : notifications[lang.label] ? `"${notifications[lang.label].replace(/"/g, '""')}"` : '""';
        return `${lang.label},${text}`;
    }).join('\n');

    console.log(csvData);

      await api.post(`/updateEmails`, {
        surveyName: surveyId,
        csvData: csvData,
      });
      
      setNotifications((prevNotifications) => ({
        ...prevNotifications,
        [selectedLanguage.label]: notificationText,
      }));

      setOriginalText(notificationText);
      setHasChanges(false);
      setAlert({
        show: true,
        type: "success",
        message: "Notification text saved successfully",
      });
    } catch (error) {
      console.error("Failed to save notification:", error);
      setAlert({
        show: true,
        type: "error",
        message: "Failed to save notification",
      });
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const csvData = e.target?.result;

        const csvArray = csvData.split("\n");
        const header = csvArray.shift().split(",");

        const newNotifications = csvArray.reduce((acc, row) => {
          // Handle quotes and commas properly using regex
          const matches = row.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g);
          if (matches && matches.length >= 2) {
            const langCode = matches[0].replace(/^,|"/g, '').trim();
            const text = matches[1].replace(/^,|"/g, '').replace(/""/g, '"').trim();
            acc[langCode] = text;
          }
          return acc;
        }, {});

        setNotifications(prevNotifications => ({
            ...prevNotifications,
            ...newNotifications
        }));

        // Update the selected language if it's not available in the new notifications
        if (!newNotifications[selectedLanguage?.code]) {
          const availableLanguages = Object.keys(newNotifications);
          if (availableLanguages.length > 0) {
            setSelectedLanguage(
              LANGUAGES.find((lang) => lang.code === availableLanguages[0])
            );
          }
        }

        await api.post("/updateEmails", {
          surveyName: surveyId,
          csvData: csvData,
        });

        setAlert({
          show: true,
          type: "success",
          message: "Notifications updated successfully from CSV",
        });
      } catch (error) {
        console.error("Failed to process CSV:", error);
        setAlert({
          show: true,
          type: "error",
          message: "Failed to update notifications from CSV",
        });
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const handleDownloadTemplate = () => {
    const csvContent = [
      "language_code,notification_text",
      ...LANGUAGES.map((lang) => `${lang.code},""`),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "notification_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <Paper
      elevation={2}
      sx={{
        p: 3,
        bgcolor: theme.palette.background.paper,
        borderRadius: 2,
      }}
    >
      <Box sx={{ mb: 2 }}>
        <Collapse in={alert.show}>
          <Alert
            severity={alert.type}
            action={
              <IconButton
                aria-label="close"
                color="inherit"
                size="small"
                onClick={handleCloseAlert}
              >
                <CloseIcon fontSize="inherit" />
              </IconButton>
            }
            sx={{ mb: 2 }}
          >
            {alert.message}
          </Alert>
        </Collapse>
      </Box>    
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
          Survey Notification Text
        </Typography>

        <Box sx={{ display: "flex", gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleDownloadTemplate}
            size="small"
          >
            Template
          </Button>
          <Button
            variant="contained"
            component="label"
            startIcon={<UploadFileIcon />}
            size="small"
          >
            Upload
            <input
              type="file"
              hidden
              accept=".csv"
              onChange={handleFileUpload}
            />
          </Button>
        </Box>
      </Box>

      <EditableTableWrapper
        onSave={handleSave}
        hasChanges={hasChanges}
        setHasChanges={setHasChanges}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <Autocomplete
            value={selectedLanguage || null}
            onChange={handleLanguageChange}
            options={LANGUAGES}
            getOptionLabel={(option) => option?.label || ""}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select Language"
                variant="outlined"
              />
            )}
            sx={{ width: "100%", maxWidth: 300 }}
          />

          <TextField
            fullWidth
            multiline
            rows={8}
            label="Notification Text"
            value={notificationText}
            onChange={handleTextChange}
            variant="outlined"
            placeholder={
              selectedLanguage
                ? `Enter notification text for ${selectedLanguage.label}...`
                : "Select a language"
            }
            sx={{
              "& .MuiOutlinedInput-root": {
                backgroundColor: theme.palette.background.default,
              },
            }}
          />
        </Box>
      </EditableTableWrapper>
    </Paper>
  );
};

export default EmailNotificationEditor;
