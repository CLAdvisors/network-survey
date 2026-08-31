import React from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Collapse,
  IconButton,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import api from "../api/axios";
import { LANGUAGES } from "@network-survey/frontend-shared";

const apiErrorMessage = (error, fallback) =>
  error.response?.data?.message || error.response?.data?.error || fallback;

const EmailNotificationEditor = ({ surveyId, readOnly = false, onDirtyChange }) => {
  const theme = useTheme();
  const [selectedLanguage, setSelectedLanguage] = React.useState(LANGUAGES[0]);
  const [notificationText, setNotificationText] = React.useState("");
  const [originalText, setOriginalText] = React.useState("");
  const [hasChanges, setHasChanges] = React.useState(false);
  const [notifications, setNotifications] = React.useState({});
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [alert, setAlert] = React.useState({ show: false, type: "info", message: "" });
  const requestVersion = React.useRef(0);
  const surveyIdRef = React.useRef(surveyId);
  const draftsRef = React.useRef(new Map());
  surveyIdRef.current = surveyId;

  const selectTemplate = React.useCallback((language, templates) => {
    const text = templates[language.label] || "";
    setSelectedLanguage(language);
    setNotificationText(text);
    setOriginalText(text);
    setHasChanges(false);
  }, []);

  React.useEffect(() => {
    const version = ++requestVersion.current;
    const controller = new AbortController();
    setNotifications({});
    setSelectedLanguage(LANGUAGES[0]);
    setNotificationText("");
    setOriginalText("");
    setHasChanges(false);
    setSaving(false);
    setImporting(false);
    setAlert({ show: false, type: "info", message: "" });

    if (!surveyId) return () => controller.abort();
    setLoading(true);
    api.get(`/survey-notifications/${surveyId}`, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted || version !== requestVersion.current) return;
        const templates = data.notifications || {};
        const draft = draftsRef.current.get(surveyId);
        const draftLanguage = LANGUAGES.find(item => item.label === draft?.language);
        const firstConfigured = LANGUAGES.find((item) => Object.prototype.hasOwnProperty.call(templates, item.label));
        const language = draftLanguage || firstConfigured || LANGUAGES[0];
        const persistedText = templates[language.label] || "";
        setNotifications(templates);
        setSelectedLanguage(language);
        setNotificationText(draft?.text ?? persistedText);
        setOriginalText(persistedText);
        setHasChanges(draft !== undefined && draft.text !== persistedText);
      })
      .catch((error) => {
        if (controller.signal.aborted || version !== requestVersion.current) return;
        setAlert({ show: true, type: "error", message: apiErrorMessage(error, "Failed to load notifications.") });
      })
      .finally(() => {
        if (!controller.signal.aborted && version === requestVersion.current) setLoading(false);
      });

    return () => controller.abort();
  }, [surveyId, selectTemplate]);

  const handleLanguageChange = (_event, language) => {
    if (!language || hasChanges) return;
    selectTemplate(language, notifications);
  };

  const handleSave = async () => {
    if (readOnly || !selectedLanguage || !hasChanges || saving || importing) return;
    const version = requestVersion.current;
    const targetSurveyId = surveyId;
    const targetLanguage = selectedLanguage.label;
    const targetText = notificationText;
    const savedDraft = draftsRef.current.get(targetSurveyId);
    setSaving(true);
    try {
      await api.post("/updateEmails", {
        surveyName: targetSurveyId,
        templates: [{ language: targetLanguage, text: targetText }],
      });
      const draftUnchanged = Boolean(savedDraft) && draftsRef.current.get(targetSurveyId) === savedDraft;
      if (draftUnchanged) {
        draftsRef.current.delete(targetSurveyId);
        onDirtyChange?.(targetSurveyId, 'invitationBody', false);
      }
      if (targetSurveyId !== surveyIdRef.current || !draftUnchanged) return;
      setNotifications((current) => ({ ...current, [targetLanguage]: targetText }));
      setOriginalText(targetText);
      setHasChanges(false);
      setAlert({ show: true, type: "success", message: "Notification text saved successfully." });
    } catch (error) {
      if (version !== requestVersion.current || targetSurveyId !== surveyIdRef.current) return;
      setAlert({ show: true, type: "error", message: apiErrorMessage(error, "Failed to save notification.") });
    } finally {
      if (version === requestVersion.current && targetSurveyId === surveyIdRef.current) setSaving(false);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || readOnly || hasChanges) return;
    const version = requestVersion.current;
    const targetSurveyId = surveyId;
    const reader = new FileReader();
    setImporting(true);
    reader.onload = async (loadEvent) => {
      try {
        if (version !== requestVersion.current || targetSurveyId !== surveyIdRef.current) return;
        await api.post("/updateEmails", { surveyName: targetSurveyId, csvData: loadEvent.target?.result });
        if (version !== requestVersion.current || targetSurveyId !== surveyIdRef.current) return;
        const response = await api.get(`/survey-notifications/${targetSurveyId}`);
        if (version !== requestVersion.current || targetSurveyId !== surveyIdRef.current) return;
        const templates = response.data.notifications || {};
        setNotifications(templates);
        selectTemplate(selectedLanguage, templates);
        setAlert({ show: true, type: "success", message: "Notifications updated successfully from CSV." });
      } catch (error) {
        if (version !== requestVersion.current || targetSurveyId !== surveyIdRef.current) return;
        setAlert({ show: true, type: "error", message: apiErrorMessage(error, "Failed to update notifications from CSV.") });
      } finally {
        if (version === requestVersion.current && targetSurveyId === surveyIdRef.current) setImporting(false);
      }
    };
    reader.onerror = () => {
      if (version === requestVersion.current && targetSurveyId === surveyIdRef.current) {
        setImporting(false);
        setAlert({ show: true, type: "error", message: "Failed to read the CSV file." });
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadTemplate = () => {
    const csvContent = [
      "Language,Text",
      ...LANGUAGES.map((language) => `${language.label},\"\"`),
    ].join("\n");
    const url = window.URL.createObjectURL(new Blob([csvContent], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "notification_template.csv";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  };

  return (
    <Paper elevation={2} sx={{ p: 3, bgcolor: theme.palette.background.paper, borderRadius: 2 }}>
      <Box sx={{ mb: 2 }}>
        {readOnly && <Alert severity="info" sx={{ mb: 2 }}>Notification templates are read-only after a survey has been launched.</Alert>}
        <Collapse {...{ in: alert.show }}>
          <Alert
            severity={alert.type}
            action={<IconButton aria-label="close" color="inherit" size="small" onClick={() => setAlert((current) => ({ ...current, show: false }))}><CloseIcon fontSize="inherit" /></IconButton>}
            sx={{ mb: 2 }}
          >
            {alert.message}
          </Alert>
        </Collapse>
      </Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3, borderBottom: `2px solid ${theme.palette.primary.main}`, pb: 1 }}>
        <Typography variant="h6" color="primary" sx={{ fontWeight: "bold" }}>Invitation Email Body</Typography>
        <Box sx={{ display: "flex", gap: 2 }}>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleDownloadTemplate} size="small">CSV template</Button>
          <Button variant="contained" component="label" startIcon={<UploadFileIcon />} size="small" disabled={readOnly || loading || saving || importing || hasChanges}>
            {importing ? "Importing…" : "Import CSV"}
            <input type="file" hidden accept=".csv,text/csv" onChange={handleFileUpload} />
          </Button>
        </Box>
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Autocomplete
          value={selectedLanguage}
          disabled={readOnly || loading || saving || importing || hasChanges}
          onChange={handleLanguageChange}
          options={LANGUAGES}
          getOptionLabel={(option) => option?.label || ""}
          disableClearable
          renderInput={(params) => <TextField {...params} label="Body language" variant="outlined" helperText={hasChanges ? "Save or revert this body before changing language." : " "} />}
          sx={{ width: "100%", maxWidth: 300 }}
        />
        <TextField
          fullWidth multiline rows={8} label="Invitation email body" value={notificationText}
          onChange={(event) => {
            if (readOnly) return;
            const nextText = event.target.value;
            setNotificationText(nextText);
            setHasChanges(nextText !== originalText);
            if (nextText === originalText) draftsRef.current.delete(surveyId);
            else draftsRef.current.set(surveyId, { language: selectedLanguage.label, text: nextText });
            onDirtyChange?.(surveyId, 'invitationBody', nextText !== originalText);
          }}
          disabled={readOnly || loading || saving || importing}
          placeholder={`Enter notification text for ${selectedLanguage?.label || "the selected language"}...`}
          sx={{ "& .MuiOutlinedInput-root": { backgroundColor: theme.palette.background.default } }}
        />
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 2 }}>
          <Button variant="outlined" disabled={readOnly || loading || saving || importing || !hasChanges} onClick={() => { draftsRef.current.delete(surveyId); onDirtyChange?.(surveyId, 'invitationBody', false); setNotificationText(originalText); setHasChanges(false); }}>Revert</Button>
          <Button variant="contained" disabled={readOnly || loading || saving || importing || !hasChanges} onClick={handleSave}>{saving ? "Saving…" : "Save body"}</Button>
        </Box>
      </Box>
    </Paper>
  );
};

export default EmailNotificationEditor;
