import React from "react";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";

const colors = {
  primary: "var(--survey-primary, #42B4AF)",
  primaryLight: "var(--survey-primary-light, #e0f7fa)",
  primaryBorder: "var(--survey-primary-border, #b2ebf2)",
  surface: "var(--survey-surface, #fafafa)",
  disabled: "var(--survey-disabled-text, #bdbdbd)",
  error: "var(--survey-error, #d32f2f)",
  muted: "var(--survey-muted-text, #666)",
  errorSurface: "var(--survey-error-surface, #fff5f5)",
};

const extractValue = (input) => {
  if (input && typeof input === "object") {
    if (Object.prototype.hasOwnProperty.call(input, "value")) {
      return input.value;
    }
    if (Object.prototype.hasOwnProperty.call(input, "id")) {
      return input.id;
    }
  }
  return input;
};

const getValueKey = (value) => {
  const plain = extractValue(value);
  if (plain === null || plain === undefined) return String(plain);
  if (typeof plain === "object") {
    try {
      return JSON.stringify(plain);
    } catch (err) {
      return String(plain);
    }
  }
  return String(plain);
};

const getChoiceText = (choice, value) => {
  if (choice && typeof choice === "object") {
    const text = choice.text ?? choice.title ?? choice.label;
    if (text !== undefined && text !== null && text !== "") {
      return text;
    }
  }
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
};

const normalizeChoice = (choice) => {
  // SurveyJS ItemValue exposes value through its prototype rather than as an
  // own property, so hasOwnProperty() leaves choices wrapped as objects.
  const value = choice && typeof choice === "object" && "value" in choice
    ? extractValue(choice.value)
    : extractValue(choice);
  return {
    source: choice,
    value,
    text: getChoiceText(choice, value),
    key: getValueKey(value)
  };
};

const buildChoiceFromValue = (value) => {
  const plain = extractValue(value);
  return {
    source: null,
    value: plain,
    text: getChoiceText(null, plain),
    key: getValueKey(plain)
  };
};

const parseMaxSelected = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(num));
};

function Item({
  item,
  provided,
  snapshot,
  actionLabel,
  onAction,
  actionButtonRef,
  actionDisabled = false,
  supplement,
  stateLabel,
  choiceContainerProps
}) {
  const text = item.text ?? (item.value !== undefined ? String(item.value) : "");
  const choiceAction = (
    <button
      ref={actionButtonRef}
      type="button"
      onClick={onAction}
      disabled={actionDisabled}
      aria-label={`${actionLabel}: ${text}`}
      style={{
        flex: "0 0 auto",
        minWidth: 52,
        minHeight: 44,
        border: 0,
        borderInlineStart: `1px solid ${colors.primaryBorder}`,
        background: "transparent",
        color: actionDisabled ? colors.disabled : colors.primary,
        cursor: actionDisabled ? "not-allowed" : "pointer",
        font: "inherit",
        fontWeight: 600,
        padding: "8px 10px"
      }}
    >
      {actionLabel}
    </button>
  );
  const supplementOwnsAction = React.isValidElement(supplement) &&
    supplement.type?.rendersChoiceAction === true;
  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...choiceContainerProps}
      style={{
        userSelect: "none",
        margin: "0 0 8px 0",
        width: "100%",
        background: snapshot.isDragging ? colors.primaryLight : colors.surface,
        border: `1px solid ${colors.primaryBorder}`,
        borderRadius: 4,
        minWidth: 80,
        display: "flex",
        flexWrap: supplement ? "wrap" : "nowrap",
        alignItems: "stretch",
        ...provided.draggableProps.style
      }}
    >
      <div
        {...provided.dragHandleProps}
        aria-label={supplement
          ? `${text}. ${stateLabel}. ${actionDisabled ? "Ranking limit reached." : "Drag to reorder or move between lists."}`
          : undefined}
        style={{
          // A zero flex basis keeps long labels from claiming the action buttons'
          // row; the label wraps inside the remaining space instead.
          flex: supplement ? "1 1 0" : "1 1 auto",
          minWidth: 0,
          padding: 8,
          textAlign: supplement ? "start" : "center",
          overflowWrap: "anywhere"
        }}
      >
        {text}
      </div>
      {supplementOwnsAction
        ? React.cloneElement(supplement, { choiceAction })
        : supplement}
      {!supplementOwnsAction && choiceAction}
    </div>
  );
}

export default function DraggableRankingQuestion({
  question,
  value,
  onChange,
  availableDirection = "horizontal",
  valueSource = "prop",
  renderChoiceSupplement,
  getChoiceContainerProps
}) {
  const [ranked, setRanked] = React.useState([]);
  const [available, setAvailable] = React.useState([]);
  const [dragSourceId, setDragSourceId] = React.useState(null);
  const actionButtonRefs = React.useRef(new Map());
  const pendingFocusKey = React.useRef(null);
  const isAvailableVertical = availableDirection === "vertical";
  const isQuestionValueSource = valueSource === "question";

  const maxSelected = React.useMemo(
    () => parseMaxSelected(question?.maxSelectedChoices),
    [question?.maxSelectedChoices]
  );

  const syncFromValue = React.useCallback((currentValue) => {
    const baseChoices = (question?.choices || []).map(normalizeChoice);
    const rankedRaw = Array.isArray(currentValue) ? currentValue : [];
    const rankedValues = rankedRaw.map(extractValue);

    let overflowValues = [];
    let effectiveRankedValues = rankedValues;

    if (maxSelected && rankedValues.length > maxSelected) {
      overflowValues = rankedValues.slice(maxSelected);
      effectiveRankedValues = rankedValues.slice(0, maxSelected);
    }

    const rankedKeys = effectiveRankedValues.map(getValueKey);
    const rankedKeySet = new Set(rankedKeys);

    const rankedChoices = effectiveRankedValues.map((val, idx) => {
      const key = rankedKeys[idx];
      return baseChoices.find((choice) => choice.key === key) || buildChoiceFromValue(val);
    });

    let availableChoices = baseChoices.filter((choice) => !rankedKeySet.has(choice.key));

    overflowValues.forEach((val) => {
      const key = getValueKey(val);
      if (!availableChoices.some((choice) => choice.key === key)) {
        availableChoices.push(buildChoiceFromValue(val));
      }
    });

    setRanked(rankedChoices);
    setAvailable(availableChoices);

    if (overflowValues.length) {
      onChange?.(rankedChoices.map((item) => item.value));
    }
  }, [question?.choices, maxSelected, onChange]);

  React.useEffect(() => {
    syncFromValue(isQuestionValueSource ? question?.value : value);
  }, [isQuestionValueSource, question, syncFromValue, value]);

  React.useEffect(() => {
    const choices = Array.isArray(question?.choices) ? question.choices : [];
    const disposers = [];

    const questionHandler = (_, options) => {
      if (options?.name === "value") {
        // SurveyJS owns question.value and can update it without rerendering
        // this independent React root.
        syncFromValue(question?.value);
      }
    };
    if (isQuestionValueSource && question?.onPropertyChanged?.add) {
      question.onPropertyChanged.add(questionHandler);
      disposers.push(() => question.onPropertyChanged.remove(questionHandler));
    }

    choices.forEach((choice) => {
      const handler = () => syncFromValue(
        isQuestionValueSource ? question?.value : value
      );
      if (choice?.onPropertyChanged?.add) {
        choice.onPropertyChanged.add(handler);
        disposers.push(() => choice.onPropertyChanged.remove(handler));
      }
    });
    return () => {
      disposers.forEach((dispose) => dispose());
    };
  }, [isQuestionValueSource, question, question?.choices, syncFromValue, value]);

  React.useEffect(() => {
    if (!pendingFocusKey.current) return;
    actionButtonRefs.current.get(pendingFocusKey.current)?.focus();
    pendingFocusKey.current = null;
  }, [available, ranked]);

  const setActionButtonRef = (list, key, node) => {
    const refKey = `${list}:${key}`;
    if (node) {
      actionButtonRefs.current.set(refKey, node);
    } else {
      actionButtonRefs.current.delete(refKey);
    }
  };

  const rankAvailableItem = (index) => {
    if (maxSelected && ranked.length >= maxSelected) return;
    const newAvailable = Array.from(available);
    const [moved] = newAvailable.splice(index, 1);
    if (!moved) return;
    pendingFocusKey.current = `ranked:${moved.key}`;
    const newRanked = [...ranked, moved];
    setAvailable(newAvailable);
    setRanked(newRanked);
    onChange?.(newRanked.map((item) => item.value));
  };

  const unrankItem = (index) => {
    const newRanked = Array.from(ranked);
    const [moved] = newRanked.splice(index, 1);
    if (!moved) return;
    pendingFocusKey.current = `available:${moved.key}`;
    setRanked(newRanked);
    setAvailable([...available, moved]);
    onChange?.(newRanked.map((item) => item.value));
  };

  const handleDragEnd = (result) => {
    setDragSourceId(null);
    const { source, destination } = result;
    if (!destination) return;

    if (source.droppableId === "ranked" && destination.droppableId === "ranked") {
      const newRanked = Array.from(ranked);
      const [moved] = newRanked.splice(source.index, 1);
      const insertIndex = typeof destination.index === "number" ? destination.index : newRanked.length;
      newRanked.splice(insertIndex, 0, moved);
      setRanked(newRanked);
      onChange?.(newRanked.map((item) => item.value));
    } else if (source.droppableId === "available" && destination.droppableId === "ranked") {
      if (maxSelected && ranked.length >= maxSelected) {
        return;
      }
      const newAvailable = Array.from(available);
      const [moved] = newAvailable.splice(source.index, 1);
      const newRanked = Array.from(ranked);
      const insertIndex = typeof destination.index === "number" ? destination.index : newRanked.length;
      newRanked.splice(insertIndex, 0, moved);
      setAvailable(newAvailable);
      setRanked(newRanked);
      onChange?.(newRanked.map((item) => item.value));
    } else if (source.droppableId === "ranked" && destination.droppableId === "available") {
      const newRanked = Array.from(ranked);
      const [moved] = newRanked.splice(source.index, 1);
      const newAvailable = Array.from(available);
      const insertIndex = typeof destination.index === "number" ? destination.index : newAvailable.length;
      newAvailable.splice(insertIndex, 0, moved);
      setRanked(newRanked);
      setAvailable(newAvailable);
      onChange?.(newRanked.map((item) => item.value));
    }
  };

  const isLimitReached = Boolean(maxSelected) && ranked.length >= (maxSelected ?? 0);

  return (
    <DragDropContext
      onDragStart={({ source }) => setDragSourceId(source.droppableId)}
      onDragEnd={handleDragEnd}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ marginBottom: 16 }}>
          <strong>Ranked (drag items here to rank):</strong>
          <Droppable
            droppableId="ranked"
            direction="vertical"
            isDropDisabled={isLimitReached && dragSourceId !== "ranked"}
          >
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                style={{
                  minHeight: 60,
                  border: snapshot.isDraggingOver
                    ? `2px solid ${colors.primary}`
                    : isLimitReached
                    ? `1px dashed ${colors.error}`
                    : `1px dashed ${colors.primaryBorder}`,
                  padding: 8,
                  borderRadius: 4,
                  background: snapshot.isDraggingOver
                    ? colors.primaryLight
                    : isLimitReached
                    ? colors.errorSurface
                    : undefined,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8
                }}
              >
                {ranked.length === 0 && (
                  <span style={{ color: colors.disabled }}>Drag options here to rank</span>
                )}
                {ranked.map((item, index) => (
                  <Draggable key={item.key} draggableId={item.key} index={index}>
                    {(provided2, snapshot2) => (
                      <Item
                        item={item}
                        provided={provided2}
                        snapshot={snapshot2}
                        actionLabel="Unrank"
                        actionButtonRef={(node) => setActionButtonRef("ranked", item.key, node)}
                        onAction={() => unrankItem(index)}
                        stateLabel={`Ranked position ${index + 1}`}
                        supplement={renderChoiceSupplement?.(item, {
                          list: "ranked",
                          isAssigned: true,
                          position: index + 1
                        })}
                        choiceContainerProps={getChoiceContainerProps?.(item, {
                          list: "ranked",
                          isAssigned: true,
                          position: index + 1
                        })}
                      />
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
          {maxSelected && (
            <div
              style={{
                marginTop: 4,
                fontSize: "0.8rem",
                color: isLimitReached ? colors.error : colors.muted
              }}
            >
              Selected {Math.min(ranked.length, maxSelected)} of {maxSelected}
            </div>
          )}
        </div>
        <div>
          <strong>Available options:</strong>
          <Droppable droppableId="available" direction={availableDirection}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                style={{
                  minHeight: 60,
                  border: snapshot.isDraggingOver ? `2px solid ${colors.primary}` : `1px dashed ${colors.primaryBorder}`,
                  padding: 8,
                  borderRadius: 4,
                  background: snapshot.isDraggingOver ? colors.primaryLight : undefined,
                  display: "flex",
                  flexDirection: isAvailableVertical ? "column" : "row",
                  flexWrap: isAvailableVertical ? "nowrap" : "wrap"
                }}
              >
                {available.map((item, index) => (
                  <Draggable key={item.key} draggableId={item.key} index={index}>
                    {(provided2, snapshot2) => (
                      <Item
                        item={item}
                        provided={provided2}
                        snapshot={snapshot2}
                        actionLabel="Rank"
                        actionButtonRef={(node) => setActionButtonRef("available", item.key, node)}
                        actionDisabled={isLimitReached}
                        onAction={() => rankAvailableItem(index)}
                        stateLabel="Available, not ranked"
                        supplement={renderChoiceSupplement?.(item, {
                          list: "available",
                          isAssigned: false,
                          position: null
                        })}
                        choiceContainerProps={getChoiceContainerProps?.(item, {
                          list: "available",
                          isAssigned: false,
                          position: null
                        })}
                      />
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </div>
      </div>
    </DragDropContext>
  );
}
