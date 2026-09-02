import React from "react";
import { Model, Serializer } from "survey-core";
import { Survey } from "survey-react-ui";
import { Alert, useTheme } from '@mui/material';
import "survey-core/survey-core.min.css";
import "@network-survey/frontend-shared/src/surveyRuntime.css";
import { buildApiUrl } from "./api";
import { attachDraggableRankingRenderer } from "@network-survey/frontend-react";
import {
  applyProductionSurveyTheme,
  PRODUCTION_SURVEY_CLASS_NAME,
  QuestionDraggableRankingModel,
  registerChoiceDefinitionProperty
} from "@network-survey/frontend-shared";
import {
  disposeTagboxSearchPlaceholder,
  restoreTagboxSearchPlaceholder
} from "./tagboxSearchPlaceholder";

// Register choice metadata before any SurveyJS Model materializes ItemValues.
registerChoiceDefinitionProperty({ visible: false });

// Register custom question type for SurveyJS
Serializer.addClass(
  "draggableranking",
  [
    { name: "choices:itemvalues", default: [] },
    { name: "maxSelectedChoices:number", default: 0, minValue: 0, displayName: "Max ranked items" }
  ],
  () => new QuestionDraggableRankingModel(""),
  "question"
);

function SurveyComponent({setTitle, setInstructions}) {
    const theme = useTheme();
    const [json, setJson] = React.useState(null);
    const [survey, setSurvey] = React.useState(null);
    const [hasResponse, setHasResponse] = React.useState(false);
    const [loadError, setLoadError] = React.useState(null);
    const [submissionError, setSubmissionError] = React.useState(null);
    const submissionInProgressRef = React.useRef(false);
    const submissionAcceptedRef = React.useRef(false);
    const runtimeGenerationRef = React.useRef(0);
    const searchParams = new URLSearchParams(window.location.search);
    const userId = searchParams.get("userId");
    const demoToken = searchParams.get("demoToken");
    const surveyName = searchParams.get("surveyName");
    const isDemo = Boolean(demoToken);

    React.useEffect(() => {
      setHasResponse(false);
      if (!userId || !surveyName || isDemo) return undefined;
      let active = true;
      const statusUrl = buildApiUrl('/user/status', { userId, surveyName });
      const request = sendRequest(statusUrl, data => active && setHasResponse(data.hasResponse));
      return () => {
        active = false;
        request?.abort?.();
      };
    }, [userId, surveyName, isDemo]);

    React.useEffect(() => {
      runtimeGenerationRef.current += 1;
      setJson(null);
      setSurvey(null);
      setTitle('');
      setInstructions?.(undefined);
      setHasResponse(false);
      setLoadError(null);
      setSubmissionError(null);
      submissionInProgressRef.current = false;
      submissionAcceptedRef.current = false;
      if ((!userId && !demoToken) || !surveyName) return undefined;

      let active = true;
      const url = buildApiUrl('/questions', { surveyName, userId, demoToken });
      const request = sendRequest(url, (data) => {
        if (!active) return;
        setJson(data.questions);
        setTitle(data.title);
        setInstructions?.(data.instructions);
      }, (message) => active && setLoadError(message));
      return () => {
        active = false;
        request?.abort?.();
      };
    }, [surveyName, setTitle, setInstructions, userId, demoToken]);

    React.useEffect(() => {
      if (!json) return;

      const newSurvey = new Model(json);
      const runtimeGeneration = runtimeGenerationRef.current;
      applyProductionSurveyTheme(newSurvey);

      // Configure survey settings
      newSurvey.showQuestionNumbers = false;
      newSurvey.showProgressBar = "bottom";
      newSurvey.progressBarType = "questions";
      newSurvey.completedHtml  = "Thank you for completing the survey.";

      // Submit before completing. This keeps respondents on the form if the API
      // rejects a stale or malformed response instead of showing a false success.
      newSurvey.onCompleting.add((sender, options) => {
        if (isDemo) return;
        if (submissionAcceptedRef.current) {
          submissionAcceptedRef.current = false;
          return;
        }
        options.allowComplete = false;
        if (submissionInProgressRef.current) return;

        submissionInProgressRef.current = true;
        setSubmissionError(null);
        const data = JSON.stringify(sender.data, null, 3);
        const url = buildApiUrl('/user');
        postRequest(url, { userId, surveyName, answers: data })
          .then(() => {
            if (runtimeGenerationRef.current !== runtimeGeneration) return;
            setHasResponse(false);
            submissionAcceptedRef.current = true;
            sender.doComplete();
          })
          .catch((error) => {
            if (runtimeGenerationRef.current !== runtimeGeneration) return;
            setSubmissionError(error.message || 'Your response could not be submitted. Please try again.');
          })
          .finally(() => {
            if (runtimeGenerationRef.current === runtimeGeneration) submissionInProgressRef.current = false;
          });
      });

      newSurvey.onChoicesLazyLoad.add((_, options) => {
        const url = buildApiUrl('/names', {
          skip: options.skip,
          take: options.take,
          filter: options.filter,
          surveyName,
          userId,
          demoToken,
        });
        sendRequest(url, (data) => {
          const names = Array.isArray(data?.names) ? data.names : [];
          const totalRaw = Number(data?.total);
          const total = Number.isFinite(totalRaw) && totalRaw >= 0 ? totalRaw : names.length;
          const items = names.map((entry) => ({ value: entry, text: entry }));
          options.setItems(items, total);
        });
      });

      const restoreTagboxHandler = (_, options) => {
        const questionElement = options.htmlElement?.matches?.(".sd-question")
          ? options.htmlElement
          : options.htmlElement?.querySelector?.(".sd-question") || options.htmlElement;
        restoreTagboxSearchPlaceholder(questionElement, options.question);
      };
      newSurvey.onAfterRenderQuestion.add(restoreTagboxHandler);
      const disposeDraggableRenderer = attachDraggableRankingRenderer(newSurvey);

      setSurvey(newSurvey);

      return () => {
        newSurvey.onAfterRenderQuestion.remove(restoreTagboxHandler);
        disposeDraggableRenderer();
        newSurvey.getAllQuestions().forEach((question) => {
          disposeTagboxSearchPlaceholder(question);
        });
        newSurvey.dispose();
      };
    }, [json, userId, surveyName, demoToken, isDemo]);

    // API handlers
    function sendRequest(url, onloadSuccessCallback, onError) {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url);
      xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
      xhr.onload = () => {
        if (xhr.status === 200) {
          onloadSuccessCallback(JSON.parse(xhr.response));
          return;
        }
        if (onError) {
          try {
            onError(JSON.parse(xhr.response).message || 'Unable to load this survey.');
          } catch {
            onError('Unable to load this survey.');
          }
        }
      };
      xhr.onerror = () => onError?.('Unable to load this survey.');
      xhr.send();
      return xhr;
    }

    async function postRequest(url, data) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
          });
      
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
      
          const jsonResponse = await response.json();
          return jsonResponse;
        } catch (error) {
          console.error('Error:', error);
          throw error;
        }
    }

    if ((!userId && !demoToken) || !surveyName) {
      return <h1>Invalid URL, please use the unique url provided by email.</h1>;
    }

    if (loadError) {
      return <Alert severity="error">{loadError}</Alert>;
    }

    if (!survey) {
      return <div></div>;
    }

    return (
      <div className={PRODUCTION_SURVEY_CLASS_NAME}>
        {isDemo && (
          <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
            Demo mode: completing this survey will not save any answers or results.
          </Alert>
        )}
        {submissionError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {submissionError}
          </Alert>
        )}
        {hasResponse && (
          <Alert
            severity="info"
            variant="outlined"
            sx={{
              mb: 2,
              borderColor: '#31C9A6',
              color: theme.palette.text.primary,
              '& .MuiAlert-icon': { color: '#31C9A6' }
            }}
          >
            You have already completed this survey. Resubmit to change your answers.
          </Alert>
        )}
        <Survey model={survey} />
      </div>
    );
}

export default SurveyComponent;