import React from "react";
import ReactDOM from "react-dom/client";
import { Model, Serializer, Question } from "survey-core";
import { Survey } from "survey-react-ui";
import { Alert, useTheme } from '@mui/material';
import "survey-core/survey-core.min.css";
import "@network-survey/frontend-shared/src/surveyRuntime.css";
import { buildApiUrl } from "./api";
import { DraggableRankingQuestion } from "@network-survey/frontend-react";
import {
  applyProductionSurveyTheme,
  PRODUCTION_SURVEY_CLASS_NAME
} from "@network-survey/frontend-shared";
import {
  disposeTagboxSearchPlaceholder,
  restoreTagboxSearchPlaceholder
} from "./tagboxSearchPlaceholder";

const draggableQuestionRoots = new WeakMap();

// Define a custom Question class for draggableranking
class QuestionDraggableRankingModel extends Question {
  getType() {
    return "draggableranking";
  }
}

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
    const searchParams = new URLSearchParams(window.location.search);
    const userId = searchParams.get("userId");
    const demoToken = searchParams.get("demoToken");
    const surveyName = searchParams.get("surveyName");
    const isDemo = Boolean(demoToken);

    React.useEffect(() => {
      if (!userId || !surveyName || isDemo) return;
      const statusUrl = buildApiUrl('/user/status', { userId, surveyName });
      sendRequest(statusUrl, data => setHasResponse(data.hasResponse));
    }, [userId, surveyName, isDemo]);

    React.useEffect(() => {
      setJson(null);
      setSurvey(null);
      setTitle('');
      setInstructions?.(undefined);
      setLoadError(null);
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
      const roots = new Set();
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
            setHasResponse(false);
            submissionAcceptedRef.current = true;
            sender.doComplete();
          })
          .catch((error) => {
            setSubmissionError(error.message || 'Your response could not be submitted. Please try again.');
          })
          .finally(() => {
            submissionInProgressRef.current = false;
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

      // Custom rendering for draggableranking
      newSurvey.onAfterRenderQuestion.add((survey, options) => {
        const questionElement = options.htmlElement?.matches?.(".sd-question")
          ? options.htmlElement
          : options.htmlElement?.querySelector(".sd-question") || options.htmlElement;

        restoreTagboxSearchPlaceholder(questionElement, options.question);

        if (options.question.getType() !== "draggableranking") {
          return;
        }

        const contentElement =
          questionElement?.querySelector(".sd-question__content") ||
          questionElement;

        const previousRoot = draggableQuestionRoots.get(options.question);
        if (previousRoot) {
          previousRoot.unmount();
          roots.delete(previousRoot);
          draggableQuestionRoots.delete(options.question);
        }

        const container = document.createElement("div");
        container.className = "draggable-ranking-host";
        contentElement.innerHTML = "";
        contentElement.appendChild(container);

        if (!options.question.title && options.question.name) {
          options.question.title = options.question.name;
        }

        const root = ReactDOM.createRoot(container);
        draggableQuestionRoots.set(options.question, root);
        roots.add(root);
        root.render(
          <DraggableRankingQuestion
            question={options.question}
            value={options.question.value || []}
            onChange={(val) => (options.question.value = val)}
            availableDirection="vertical"
            valueSource="question"
          />
        );
      });

      setSurvey(newSurvey);

      return () => {
        newSurvey.getAllQuestions().forEach((question) => {
          disposeTagboxSearchPlaceholder(question);
          draggableQuestionRoots.delete(question);
        });
        roots.forEach((root) => root.unmount());
        roots.clear();
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