import React, { useEffect, useState, useRef, useCallback } from 'react';
import { SurveyCreator, SurveyCreatorComponent } from 'survey-creator-react';
import "survey-core/survey-core.css";
import "survey-creator-core/survey-creator-core.css";
import "@network-survey/frontend-shared/src/surveyRuntime.css";
// SurveyJS runtime themes are applied to each model via applyTheme().
import { Alert, Box, Autocomplete, TextField, Button, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import api from '../api/axios';
import { Serializer, Question, Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import { ReactQuestionFactory } from 'survey-react-ui';
import {
  attachDraggableRankingRenderer,
  DraggableRankingQuestion,
} from '@network-survey/frontend-react';
import {
  applyProductionSurveyTheme,
  PRODUCTION_SURVEY_CLASS_NAME,
  PRODUCTION_SURVEY_WRAPPER_SX,
  TAGBOX_PAGE_SIZE,
  TAGBOX_PLACEHOLDER
} from '@network-survey/frontend-shared';
import {
  restrictSurveyToolbox,
  setSurveyToolboxItem,
  SUPPORTED_SURVEY_TOOLBOX_TYPES,
} from '../utils/surveyToolbox';
import { hideQuestionValueName } from '../utils/surveyCreatorMetadata';
import {
  configureDraggableRankingChoiceEditor,
  normalizeDraggableRankingDefinitions,
  registerDraggableRankingDefinitionMetadata,
  validateDraggableRankingDefinitionProperty,
} from '../utils/draggableRankingDefinitions';
import { serializeFlatSurveySchema } from '../utils/surveySchemaSerialization';
import { lifecycleLabel, lifecycleStatus, surveyId } from './surveyLifecycle';
import { useAuth } from '../context/AuthContext';

// ItemValue metadata must exist before Survey Creator constructs any choices.
registerDraggableRankingDefinitionMetadata();

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
    valueSource="question"
  />
));

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

    const allowedProperties = new Set(['title', 'isRequired', 'claMaxSelections']);
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

const cleanupDraggableSurveyRoots = (survey) => {
  if (!survey || typeof survey.getAllQuestions !== 'function') return;
  survey.getAllQuestions().forEach((question) => {
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

// Hide survey-level metadata and alternate question answer keys from the
// dashboard property panel. The API assigns canonical question names.
Serializer.removeProperty('survey', 'title');
Serializer.removeProperty('survey', 'description');
Serializer.removeProperty('survey', 'logo');
hideQuestionValueName();

const SurveyEditor = () => {
  const { canEditSurvey } = useAuth();
  const [surveys, setSurveys] = useState([]);
  const [selectedSurvey, setSelectedSurvey] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSurveyModel, setPreviewSurveyModel] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const creatorRef = useRef(null);
  const surveyHooksRef = useRef(new Map());
  const selectedSurveyRef = useRef(null);
  const selectedSurveyRecord = surveys.find((survey) => surveyId(survey) === selectedSurvey || survey.name === selectedSurvey) || null;
  const lifecycleLocked = Boolean(selectedSurveyRecord) && lifecycleStatus(selectedSurveyRecord) !== 'draft';
  const roleLocked = Boolean(selectedSurveyRecord) && !canEditSurvey(selectedSurveyRecord);
  const editorReadOnly = lifecycleLocked || roleLocked;

  // Refresh lifecycle/role state while the editor remains open.
  useEffect(() => {
    const controller = new AbortController();
    let first = true;
    let inFlight = false;
    const fetchSurveys = async () => {
      if (inFlight) return;
      inFlight = true;
      if (first) setLoading(true);
      try {
        const response = await api.get('/surveys', { signal: controller.signal });
        if (!controller.signal.aborted) {
          const nextSurveys = response.data.surveys || [];
          setSurveys(nextSurveys);
          setSelectedSurvey((current) => current && !nextSurveys.some((survey) => surveyId(survey) === current || survey.name === current) ? null : current);
        }
      } catch (err) {
        if (first && !controller.signal.aborted) setSurveys([]);
      } finally {
        if (first && !controller.signal.aborted) setLoading(false);
        first = false;
        inFlight = false;
      }
    };
    fetchSurveys();
    const timer = setInterval(fetchSurveys, 30000);
    return () => { clearInterval(timer); controller.abort(); };
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
      existing.cleanup?.();
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
        const response = await api.get('/admin/names', {
          params: {
            skip,
            take,
            filter,
            surveyName: currentSurveyName
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

    // Creator's Preview tab and the custom Demo Survey intentionally share the
    // exact production renderer used by the respondent application.
    const disposeDraggableRenderer = context === 'designer'
      ? null
      : attachDraggableRankingRenderer(surveyModel);

    const cleanup = () => {
      surveyModel.onChoicesLazyLoad.remove(lazyLoadHandler);
      surveyModel.onQuestionAdded.remove(questionAddedHandler);
      surveyModel.onQuestionRemoved.remove(questionRemovedHandler);
      disposeDraggableRenderer?.();
    };

    surveyHooksRef.current.set(surveyModel, {
      lazyLoadHandler,
      questionAddedHandler,
      questionRemovedHandler,
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
    // Match the API's flat, answer-bearing schema contract. This excludes
    // nested containers and display-only elements from the authoring UI.
    questionTypes: [...SUPPORTED_SURVEY_TOOLBOX_TYPES],
  };
  if (!creatorRef.current) {
    creatorRef.current = new SurveyCreator(creatorOptions);
    creatorRef.current.onSetPropertyEditorOptions.add(configureDraggableRankingChoiceEditor);
    creatorRef.current.onPropertyDisplayCustomError.add(validateDraggableRankingDefinitionProperty);
    // Add custom draggable-ranking question with a JSON template. Remove any
    // generated item first so the custom item appears exactly once.
    setSurveyToolboxItem(creatorRef.current.toolbox, {
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
    // Ensure tagbox uses the custom lazy-load configuration without leaving the
    // default toolbox item alongside it.
    setSurveyToolboxItem(creatorRef.current.toolbox, {
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
    // Defensively remove any defaults introduced by Survey Creator upgrades.
    restrictSurveyToolbox(creatorRef.current.toolbox);
  }
  const creator = creatorRef.current;

  const buildNormalizedSurveySchema = useCallback(() => {
    const editorJson = creator?.survey?.toJSON ? creator.survey.toJSON() : creator?.JSON;
    const rawJson = editorJson ? JSON.parse(JSON.stringify(editorJson)) : {};
    const flatSchema = serializeFlatSurveySchema(rawJson);
    return {
      ...flatSchema,
      elements: normalizeDraggableRankingDefinitions(normalizeTagboxElements(flatSchema.elements))
    };
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
        applyProductionSurveyTheme(options.survey);
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

  // Normalize the one logical editor page while rejecting unsupported layouts
  // before Survey Creator can silently discard them in single-page mode.
  useEffect(() => {
    const controller = new AbortController();
    creator.readOnly = editorReadOnly;
    if (!selectedSurvey) {
      creator.JSON = {};
      return;
    }
    const loadSurvey = async () => {
      setLoading(true);
      try {
        // Use the full survey JSON endpoint
        const response = await api.get(`/admin/questions?surveyName=${selectedSurvey}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const json = response.data.questions || {};
        const flatSchema = serializeFlatSurveySchema(json);
        creator.JSON = {
          ...flatSchema,
          elements: normalizeTagboxElements(flatSchema.elements)
        };
        setSaveError(null);
        if (creator.survey) {
          configureSurveyModel(creator.survey, 'designer');
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          creator.JSON = {};
          setSaveError(err.response?.data?.message || err.message || 'Unable to load survey. Please try again.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    loadSurvey();
    return () => controller.abort();
  }, [selectedSurvey, creator, configureSurveyModel, editorReadOnly]);

  const handleSaveSurvey = async () => {
    if (!selectedSurvey || editorReadOnly) return;
    const savingSurveyName = selectedSurvey;
    setSaving(true);
    setSaveError(null);
    try {
      const questions = buildNormalizedSurveySchema();
      // Preserve editor identities and expression references in the request. The
      // API canonicalizes positional names and rewrites references atomically.
      const response = await api.post('/updateQuestions', {
        surveyName: selectedSurvey,
        questions
      });
      // Adopt the API's canonical names immediately. Otherwise Survey Creator
      // retains temporary names and a second save allocates fresh identities.
      if (selectedSurveyRef.current !== savingSurveyName) return;
      const savedSchema = serializeFlatSurveySchema(response.data?.questions || questions);
      creator.JSON = {
        ...savedSchema,
        elements: normalizeTagboxElements(savedSchema.elements)
      };
      if (creator.survey) {
        configureSurveyModel(creator.survey, 'designer');
      }
    } catch (err) {
      if (selectedSurveyRef.current === savingSurveyName) setSaveError(err.response?.data?.message || err.message || 'Unable to save survey. Please try again.');
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
      const model = new Model(questions);
      applyProductionSurveyTheme(model);
      model.showQuestionNumbers = false;
      model.showProgressBar = 'bottom';
      model.progressBarType = 'questions';

      configureSurveyModel(model, 'preview-runtime');
      setPreviewSurveyModel(model);
      setPreviewError(null);
      setPreviewOpen(true);
    } catch (error) {
      setPreviewSurveyModel(null);
      setPreviewError(error.message || 'Unable to load survey preview.');
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
      const matchingSurvey = surveys.find((survey) => survey.name === newValue);
      setSelectedSurvey(matchingSurvey ? surveyId(matchingSurvey) : null);
    } else if (newValue && newValue.name) {
      setSelectedSurvey(surveyId(newValue));
    } else {
      setSelectedSurvey(null);
    }
  };

  return (
    <Box sx={{ marginTop: '20px', marginLeft: '2%', marginRight: '2%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Autocomplete
          options={surveys}
          disabled={saving}
          getOptionLabel={(option) => typeof option === 'string' ? option : option.name || ''}
          isOptionEqualToValue={(option, value) => surveyId(option) === surveyId(value)}
          value={selectedSurveyRecord}
          onChange={handleSurveyChange}
          inputValue={inputValue}
          onInputChange={(e, v) => setInputValue(v)}
          renderInput={(params) => (
            <TextField {...params} label="Select Survey" variant="outlined" size="small" />
          )}
          sx={{ minWidth: 300 }}
        />
        {saving && <CircularProgress size={24} />}
        <Button
          variant="contained"
          onClick={handleSaveSurvey}
          disabled={!selectedSurvey || saving || editorReadOnly}
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
      {lifecycleLocked && <Alert severity="info" sx={{ mb: 2 }}>Survey design is read-only while this survey is {lifecycleLabel(lifecycleStatus(selectedSurveyRecord)).toLowerCase()}. You can still preview it.</Alert>}
      {roleLocked && <Alert severity="info" sx={{ mb: 2 }}>Your role has read-only access to this survey design. You can still preview it.</Alert>}
      {saveError && <Alert severity="error" sx={{ mb: 2 }}>{saveError}</Alert>}
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
            <Box
              className={PRODUCTION_SURVEY_CLASS_NAME}
              data-testid="branded-survey-wrapper"
              sx={PRODUCTION_SURVEY_WRAPPER_SX}
            >
              <Survey model={previewSurveyModel} />
            </Box>
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
