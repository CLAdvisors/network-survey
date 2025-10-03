import React, { useEffect, useState, useRef, useCallback } from 'react';
import { SurveyCreator, SurveyCreatorComponent } from 'survey-creator-react';
import "survey-core/survey-core.css";
import "survey-creator-core/survey-creator-core.css";
// Base SurveyJS styles (theme is applied via cssType)
import { Box, Autocomplete, TextField, Button, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import api from '../api/axios';
import { Serializer, Question, Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import { ReactQuestionFactory } from 'survey-react-ui';
import DraggableRankingQuestion from './DraggableRankingQuestion';
import ReactDOM from 'react-dom/client';

// Define and register custom question class for draggableranking
class QuestionDraggableRankingModel extends Question {
  getType() {
    return 'draggableranking';
  }
}
// Register class without inline properties, then define choices property correctly
Serializer.addClass(
  'draggableranking',
  [],
  () => new QuestionDraggableRankingModel(''),
  'question'
);
// Register choices property with correct type and category for SurveyJS property panel
Serializer.addProperty('draggableranking', { name: 'choices:itemvalue[]', default: [], category: 'choices' });
Serializer.addProperty('draggableranking', {
  name: 'maxSelectedChoices:number',
  default: 0,
  minValue: 0,
  category: 'choices',
  displayName: 'Max ranked items'
});
// Assign an iconName so the custom type has an icon in the toolbox
Serializer.addProperty('draggableranking', { name: 'iconName', default: 'icon-tagbox' });
// Register React component for editor preview
ReactQuestionFactory.Instance.registerQuestion('draggableranking', props => (
  <DraggableRankingQuestion
    question={props.question}
    value={props.question.value || []}
    onChange={val => props.question.value = val}
  />
));

const TAGBOX_PLACEHOLDER = 'Start typing to search for people';
const TAGBOX_PAGE_SIZE = 25;
const PREVIEW_USER_ID = 'demo';
const draggableQuestionRoots = new WeakMap();

const configureTagboxPropertyMetadata = (() => {
  let configured = false;
  return () => {
    if (configured) return;
    configured = true;

    if (!Serializer.findProperty('tagbox', 'claMaxSelections')) {
      Serializer.addProperty('tagbox', {
        name: 'claMaxSelections:number',
        default: 0,
        minValue: 0,
        category: 'general',
        displayName: 'Max selections'
      });
    }

    const allowedProperties = new Set(['title', 'claMaxSelections']);
    Serializer.getProperties('tagbox').forEach((prop) => {
      const isAllowed = allowedProperties.has(prop.name);
      prop.visible = isAllowed;
      if (isAllowed) {
        prop.category = 'general';
      }
    });
  };
})();

configureTagboxPropertyMetadata();

const ensureTagboxQuestionBehavior = (question) => {
  if (!question || typeof question.getType !== 'function') return;
  if (question.getType() !== 'tagbox') return;

  const syncMaxSelections = (rawValue) => {
    const numeric = Number(rawValue ?? question.claMaxSelections ?? question.maxSelectedChoices ?? 0);
    const safe = Number.isFinite(numeric) && numeric > 0 ? Math.max(1, Math.floor(numeric)) : 0;
    if (question._claSyncing) {
      return safe;
    }
    question._claSyncing = true;
    try {
      if (question.maxSelectedChoices !== safe) {
        question.maxSelectedChoices = safe;
      }
      if (Number(question.claMaxSelections ?? 0) !== safe) {
        question.claMaxSelections = safe;
      }
    } finally {
      question._claSyncing = false;
    }
    return safe;
  };

  if (!question._claRequiredSyncing && question.isRequired !== true) {
    question._claRequiredSyncing = true;
    try {
      question.isRequired = true;
    } finally {
      question._claRequiredSyncing = false;
    }
  }

  question.choices = Array.isArray(question.choices) ? question.choices : [];
  question.choicesLazyLoadEnabled = true;
  if (!question.choicesLazyLoadPageSize || Number(question.choicesLazyLoadPageSize) <= 0) {
    question.choicesLazyLoadPageSize = TAGBOX_PAGE_SIZE;
  }
  question.allowAddNewTag = false;
  if (question.searchEnabled === false) {
    question.searchEnabled = true;
  }
  if (!question.placeholder) {
    question.placeholder = TAGBOX_PLACEHOLDER;
  }
  if (!question.optionsCaption) {
    question.optionsCaption = 'Type to search';
  }

  syncMaxSelections(question.claMaxSelections ?? question.maxSelectedChoices ?? 0);

  if (question.onPropertyChanged && !question._claMaxSelectionWatcher) {
    const handler = (_, options) => {
      if (!options?.name || question._claSyncing) {
        return;
      }
      if (options.name === 'claMaxSelections' || options.name === 'maxSelectedChoices') {
        syncMaxSelections(options.newValue);
      }
    };
    question.onPropertyChanged.add(handler);
    question._claMaxSelectionWatcher = handler;
  }
  if (question.onPropertyChanged && !question._claRequiredWatcher) {
    const requiredWatcher = (_, options) => {
      if (!options?.name) {
        return;
      }
      if (options.name === 'isRequired' && options.newValue !== true) {
        if (question._claRequiredSyncing) {
          return;
        }
        question._claRequiredSyncing = true;
        try {
          question.isRequired = true;
        } finally {
          question._claRequiredSyncing = false;
        }
      }
    };
    question.onPropertyChanged.add(requiredWatcher);
    question._claRequiredWatcher = requiredWatcher;
  }
};

const normalizeTagboxElements = (elements) => {
  if (!Array.isArray(elements)) return elements;
  return elements.map((element) => {
    if (!element || typeof element !== 'object') {
      return element;
    }
    const normalized = { ...element };
    if (Array.isArray(normalized.elements)) {
      normalized.elements = normalizeTagboxElements(normalized.elements);
    }
    if (Array.isArray(normalized.templateElements)) {
      normalized.templateElements = normalizeTagboxElements(normalized.templateElements);
    }
    if (normalized.type === 'tagbox') {
      if (!Array.isArray(normalized.choices)) {
        normalized.choices = [];
      }
      normalized.choicesLazyLoadEnabled = true;
      if (!normalized.choicesLazyLoadPageSize || Number(normalized.choicesLazyLoadPageSize) <= 0) {
        normalized.choicesLazyLoadPageSize = TAGBOX_PAGE_SIZE;
      }
      normalized.allowAddNewTag = false;
      if (!normalized.placeholder) {
        normalized.placeholder = TAGBOX_PLACEHOLDER;
      }
      if (!normalized.optionsCaption) {
        normalized.optionsCaption = 'Type to search';
      }
      normalized.isRequired = true;
      const rawLimit = Number(normalized.claMaxSelections ?? normalized.maxSelectedChoices ?? 0);
      const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.max(1, Math.floor(rawLimit)) : 0;
      if (safeLimit > 0) {
        normalized.claMaxSelections = safeLimit;
        normalized.maxSelectedChoices = safeLimit;
      } else {
        normalized.claMaxSelections = 0;
        delete normalized.maxSelectedChoices;
      }
    }
    return normalized;
  });
};

const extractElementsFromSurveyJson = (json) => {
  if (!json || typeof json !== 'object') {
    return [];
  }
  if (Array.isArray(json.pages)) {
    const aggregated = [];
    json.pages.forEach((page) => {
      if (Array.isArray(page?.elements)) {
        aggregated.push(...page.elements);
      }
    });
    return aggregated;
  }
  if (Array.isArray(json.elements)) {
    return json.elements;
  }
  return [];
};

const cleanupDraggableQuestionRoot = (question) => {
  if (!question) return;
  const root = draggableQuestionRoots.get(question);
  if (root) {
    root.unmount();
    draggableQuestionRoots.delete(question);
  }
};

const cleanupDraggableSurveyRoots = (survey) => {
  if (!survey || typeof survey.getAllQuestions !== 'function') return;
  survey.getAllQuestions().forEach((question) => {
    cleanupDraggableQuestionRoot(question);
    if (question?._claMaxSelectionWatcher && question.onPropertyChanged?.remove) {
      question.onPropertyChanged.remove(question._claMaxSelectionWatcher);
      delete question._claMaxSelectionWatcher;
    }
    if (question?._claRequiredWatcher && question.onPropertyChanged?.remove) {
      question.onPropertyChanged.remove(question._claRequiredWatcher);
      delete question._claRequiredWatcher;
    }
  });
};

// Hide survey title, description, and image from the property panel
Serializer.removeProperty('survey', 'title');
Serializer.removeProperty('survey', 'description');
Serializer.removeProperty('survey', 'logo');

const SurveyEditor = () => {
  const [surveys, setSurveys] = useState([]);
  const [selectedSurvey, setSelectedSurvey] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSurveyModel, setPreviewSurveyModel] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const creatorRef = useRef(null);
  const surveyHooksRef = useRef(new Map());
  const selectedSurveyRef = useRef(null);

  // Fetch surveys on mount
  useEffect(() => {
    const fetchSurveys = async () => {
      setLoading(true);
      try {
        const response = await api.get('/surveys');
        setSurveys(response.data.surveys || []);
      } catch (err) {
        setSurveys([]);
      } finally {
        setLoading(false);
      }
    };
    fetchSurveys();
  }, []);

  useEffect(() => {
    selectedSurveyRef.current = selectedSurvey;
  }, [selectedSurvey]);

  const configureSurveyModel = useCallback((surveyModel, context = 'designer') => {
    if (!surveyModel || typeof surveyModel.onChoicesLazyLoad === 'undefined') {
      return;
    }

    const existing = surveyHooksRef.current.get(surveyModel);
    if (existing) {
      if (existing.lazyLoadHandler) {
        surveyModel.onChoicesLazyLoad.remove(existing.lazyLoadHandler);
      }
      if (existing.questionAddedHandler) {
        surveyModel.onQuestionAdded.remove(existing.questionAddedHandler);
      }
      if (existing.questionRemovedHandler) {
        surveyModel.onQuestionRemoved.remove(existing.questionRemovedHandler);
      }
      if (existing.afterRenderHandler) {
        surveyModel.onAfterRenderQuestion.remove(existing.afterRenderHandler);
      }
      surveyHooksRef.current.delete(surveyModel);
    }

    surveyModel.getAllQuestions().forEach((question) => ensureTagboxQuestionBehavior(question));

    const questionAddedHandler = (_, options) => {
      if (options?.question) {
        ensureTagboxQuestionBehavior(options.question);
      }
    };

    const questionRemovedHandler = (_, options) => {
      if (options?.question) {
        cleanupDraggableQuestionRoot(options.question);
        if (options.question._claMaxSelectionWatcher && options.question.onPropertyChanged?.remove) {
          options.question.onPropertyChanged.remove(options.question._claMaxSelectionWatcher);
          delete options.question._claMaxSelectionWatcher;
        }
        if (options.question._claRequiredWatcher && options.question.onPropertyChanged?.remove) {
          options.question.onPropertyChanged.remove(options.question._claRequiredWatcher);
          delete options.question._claRequiredWatcher;
        }
      }
    };

    const lazyLoadHandler = async (_, options) => {
      const currentSurveyName = selectedSurveyRef.current;
      if (!currentSurveyName) {
        options.setItems([], 0);
        return;
      }

      const skip = Number.isFinite(options.skip) ? options.skip : 0;
      const takeRaw = Number.isFinite(options.take) && options.take > 0 ? options.take : TAGBOX_PAGE_SIZE;
      const take = Math.min(takeRaw, 100);
      const filter = typeof options.filter === 'string' ? options.filter : '';

      try {
        const response = await api.get('/names', {
          params: {
            skip,
            take,
            filter,
            surveyName: currentSurveyName,
            userId: PREVIEW_USER_ID
          }
        });
        const names = Array.isArray(response?.data?.names) ? response.data.names : [];
        const totalRaw = Number(response?.data?.total);
        const total = Number.isFinite(totalRaw) && totalRaw >= 0 ? totalRaw : names.length;
        const items = names.map((entry) => ({ value: entry, text: entry }));
        options.setItems(items, total);
      } catch (error) {
        options.setItems([], 0);
      }
    };

    surveyModel.onChoicesLazyLoad.add(lazyLoadHandler);
    surveyModel.onQuestionAdded.add(questionAddedHandler);
    surveyModel.onQuestionRemoved.add(questionRemovedHandler);

    let afterRenderHandler = null;
    if (context !== 'designer') {
      afterRenderHandler = (survey, options) => {
        if (!options?.question || options.question.getType() !== 'draggableranking') {
          return;
        }

        const contentElement =
          options.htmlElement?.querySelector?.('.sd-question__content') || options.htmlElement;
        if (!contentElement) {
          return;
        }

        cleanupDraggableQuestionRoot(options.question);

        const container = document.createElement('div');
        container.className = 'draggable-ranking-host';
        contentElement.innerHTML = '';
        contentElement.appendChild(container);

        if (!options.question.title && options.question.name) {
          options.question.title = options.question.name;
        }

        const root = ReactDOM.createRoot(container);
        draggableQuestionRoots.set(options.question, root);
        root.render(
          <DraggableRankingQuestion
            question={options.question}
            value={options.question.value || []}
            onChange={(val) => (options.question.value = val)}
          />
        );
      };
      surveyModel.onAfterRenderQuestion.add(afterRenderHandler);
    }

    const cleanup = () => {
      surveyModel.onChoicesLazyLoad.remove(lazyLoadHandler);
      surveyModel.onQuestionAdded.remove(questionAddedHandler);
      surveyModel.onQuestionRemoved.remove(questionRemovedHandler);
      if (afterRenderHandler) {
        surveyModel.onAfterRenderQuestion.remove(afterRenderHandler);
      }
    };

    surveyHooksRef.current.set(surveyModel, {
      lazyLoadHandler,
      questionAddedHandler,
      questionRemovedHandler,
      afterRenderHandler,
      cleanup,
      context
    });
  }, []);

  // SurveyJS Creator setup
  const creatorOptions = {
    showLogicTab: false,
    showJSONEditorTab: false,
    isAutoSave: false,
    showPagesPanel: false,
    pageEditMode: 'single',
    showTitle: false, // hide survey title in editor
    showDescription: false,  // hide survey description in editor
    showLogo: false,         // hide survey image/logo in editor
    // Use default questionTypes, we’ll add our custom item manually
  };
  if (!creatorRef.current) {
    creatorRef.current = new SurveyCreator(creatorOptions);
    // Add custom draggable-ranking question with a JSON template
    creatorRef.current.toolbox.addItem({
      name: 'draggableranking',
      iconName: 'icon-tagbox',
      title: 'Draggable Ranking',
      json: {
        type: 'draggableranking',
        name: 'draggableranking1',
        title: 'Draggable Ranking',
        choices: [
          { value: 'item1', text: 'Item 1' },
          { value: 'item2', text: 'Item 2' }
        ]
      }
    });
    // Ensure tagbox is available with default lazy-load configuration
    creatorRef.current.toolbox.addItem({
      name: 'tagbox',
      iconName: 'icon-tagbox',
      title: 'People Tagbox',
      json: {
        type: 'tagbox',
        name: 'tagbox1',
        title: 'Select people',
        isRequired: true,
        claMaxSelections: 0,
        placeholder: TAGBOX_PLACEHOLDER,
        allowAddNewTag: false,
        choices: [],
        choicesLazyLoadEnabled: true,
        choicesLazyLoadPageSize: TAGBOX_PAGE_SIZE
      }
    });
  }
  const creator = creatorRef.current;

  const buildNormalizedSurveySchema = useCallback(() => {
    try {
      const rawJson = creator && creator.JSON ? JSON.parse(JSON.stringify(creator.JSON)) : {};
      const elements = normalizeTagboxElements(extractElementsFromSurveyJson(rawJson));
      return { elements };
    } catch (error) {
      return { elements: [] };
    }
  }, [creator]);

  useEffect(() => {
    if (!creator || !creator.onSurveyInstanceCreated) {
      return;
    }

    const handler = (_, options) => {
      if (!options?.survey || !options.area) return;
      if (options.area === 'designer-tab') {
        configureSurveyModel(options.survey, 'designer');
      }
      if (options.area === 'preview-tab') {
        configureSurveyModel(options.survey, 'preview');
      }
    };

    creator.onSurveyInstanceCreated.add(handler);
    if (creator.survey) {
      configureSurveyModel(creator.survey, 'designer');
    }
    return () => {
      creator.onSurveyInstanceCreated.remove(handler);
    };
  }, [creator, configureSurveyModel]);

  useEffect(() => {
    const hooksMap = surveyHooksRef.current;
    return () => {
      hooksMap.forEach((hooks, survey) => {
        if (hooks?.cleanup) {
          hooks.cleanup();
        }
        cleanupDraggableSurveyRoots(survey);
      });
      hooksMap.clear();
    };
  }, []);

  // Remove pages from loaded survey JSON (flatten to single elements array)
  useEffect(() => {
    if (!selectedSurvey) {
      creator.JSON = {};
      return;
    }
    const loadSurvey = async () => {
      setLoading(true);
      try {
        // Use the full survey JSON endpoint
        const response = await api.get(`/questions?surveyName=${selectedSurvey}`);
        let json = response.data.questions || {};
        // Flatten any pages into a single elements array
        let elements = [];
        if (Array.isArray(json.pages)) {
          json.pages.forEach(page => {
            if (Array.isArray(page.elements)) {
              elements.push(...page.elements);
            }
          });
        } else if (Array.isArray(json.elements)) {
          elements = json.elements;
        }
        const preparedElements = normalizeTagboxElements(elements);
        creator.JSON = { elements: preparedElements };
        if (creator.survey) {
          configureSurveyModel(creator.survey, 'designer');
        }
      } catch (err) {
        creator.JSON = {};
      } finally {
        setLoading(false);
      }
    };
    loadSurvey();
  }, [selectedSurvey, creator, configureSurveyModel]);

  // Save handler (always use current JSON from creator, flatten pages if present)
  const handleSaveSurvey = async () => {
    if (!selectedSurvey) return;
    setSaving(true);
    try {
      const questions = buildNormalizedSurveySchema();
      await api.post('/updateQuestions', {
        surveyName: selectedSurvey,
        questions
      });
    } catch (err) {
      // Optionally show error
    } finally {
      setSaving(false);
    }
  };

  const handleOpenPreview = () => {
    if (!selectedSurvey) {
      return;
    }

    try {
      const questions = buildNormalizedSurveySchema();
      const previewJson = questions?.elements ? { elements: questions.elements } : {};
      const model = new Model(previewJson);
      model.showQuestionNumbers = false;
      model.showProgressBar = 'bottom';
      model.progressBarType = 'questions';
  Model.cssType = 'default';

      configureSurveyModel(model, 'preview-runtime');
      setPreviewSurveyModel(model);
      setPreviewError(null);
      setPreviewOpen(true);
    } catch (error) {
      setPreviewSurveyModel(null);
      setPreviewError('Unable to load survey preview.');
      setPreviewOpen(true);
    }
  };

  const handleClosePreview = () => {
    if (previewSurveyModel) {
      const hooks = surveyHooksRef.current.get(previewSurveyModel);
      if (hooks?.cleanup) {
        hooks.cleanup();
      }
      surveyHooksRef.current.delete(previewSurveyModel);
      cleanupDraggableSurveyRoots(previewSurveyModel);
      if (typeof previewSurveyModel.dispose === 'function') {
        previewSurveyModel.dispose();
      }
    }
    setPreviewSurveyModel(null);
    setPreviewOpen(false);
    setPreviewError(null);
  };

  // Handle survey selection or creation
  const handleSurveyChange = (event, newValue) => {
    if (typeof newValue === 'string') {
      setSelectedSurvey(newValue);
    } else if (newValue && newValue.name) {
      setSelectedSurvey(newValue.name);
    } else {
      setSelectedSurvey(null);
    }
  };

  return (
    <Box sx={{ marginTop: '20px', marginLeft: '2%', marginRight: '2%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Autocomplete
          freeSolo
          options={surveys.map(s => s.name)}
          value={selectedSurvey || ''}
          onChange={handleSurveyChange}
          inputValue={inputValue}
          onInputChange={(e, v) => setInputValue(v)}
          renderInput={(params) => (
            <TextField {...params} label="Select or Create Survey" variant="outlined" size="small" />
          )}
          sx={{ minWidth: 300 }}
        />
        {saving && <CircularProgress size={24} />}
        <Button
          variant="contained"
          onClick={handleSaveSurvey}
          disabled={!selectedSurvey || saving}
        >
          Save Survey
        </Button>
        <Button
          variant="outlined"
          onClick={handleOpenPreview}
          disabled={!selectedSurvey || loading}
        >
          Demo Survey
        </Button>
      </Box>
      <Box
        sx={{
          padding: '20px',
          height: 'calc(100vh - 120px)',
          border: '1px solid #ccc',
          borderRadius: '8px',
          backgroundColor: '#fff',
          overflow: 'auto',
        }}
      >
        {loading ? <CircularProgress /> : <SurveyCreatorComponent creator={creator} />}
      </Box>
      <Dialog
        open={previewOpen}
        onClose={handleClosePreview}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Survey Demo</DialogTitle>
        <DialogContent dividers sx={{ minHeight: 300 }}>
          {previewError && (
            <Box sx={{ py: 2 }}>{previewError}</Box>
          )}
          {!previewError && !previewSurveyModel && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}
          {!previewError && previewSurveyModel && (
            <Survey model={previewSurveyModel} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClosePreview}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SurveyEditor;
