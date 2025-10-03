import React from "react";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";

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
  const value = choice && typeof choice === "object" && Object.prototype.hasOwnProperty.call(choice, "value")
    ? extractValue(choice.value)
    : extractValue(choice);
  return {
    value,
    text: getChoiceText(choice, value),
    key: getValueKey(value)
  };
};

const buildChoiceFromValue = (value) => {
  const plain = extractValue(value);
  return {
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

function Item({ item, provided, snapshot }) {
  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      style={{
        userSelect: "none",
        padding: 8,
        margin: "0 8px 8px 0",
        background: snapshot.isDragging ? "#e0f7fa" : "#fafafa",
        border: "1px solid #b2ebf2",
        borderRadius: 4,
        minWidth: 80,
        textAlign: "center",
        ...provided.draggableProps.style
      }}
    >
      {item.text ?? (item.value !== undefined ? String(item.value) : "")}
    </div>
  );
}

export default function DraggableRankingQuestion({ question, value, onChange }) {
  const [ranked, setRanked] = React.useState([]);
  const [available, setAvailable] = React.useState([]);

  const maxSelected = React.useMemo(
    () => parseMaxSelected(question?.maxSelectedChoices),
    [question?.maxSelectedChoices]
  );

  const syncFromProps = React.useCallback(() => {
    const baseChoices = (question?.choices || []).map(normalizeChoice);
    const rankedRaw = Array.isArray(value) ? value : [];
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
  }, [question?.choices, value, maxSelected, onChange]);

  React.useEffect(() => {
    syncFromProps();
  }, [syncFromProps]);

  React.useEffect(() => {
    const choices = Array.isArray(question?.choices) ? question.choices : [];
    if (choices.length === 0) return;
    const disposers = [];
    choices.forEach((choice) => {
      const handler = () => syncFromProps();
      if (choice?.onPropertyChanged?.add) {
        choice.onPropertyChanged.add(handler);
        disposers.push(() => choice.onPropertyChanged.remove(handler));
      }
    });
    return () => {
      disposers.forEach((dispose) => dispose());
    };
  }, [question?.choices, syncFromProps]);

  const handleDragEnd = (result) => {
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
    <DragDropContext onDragEnd={handleDragEnd}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ marginBottom: 16 }}>
          <strong>Ranked (drag items here to rank):</strong>
          <Droppable
            droppableId="ranked"
            direction="horizontal"
            isDropDisabled={isLimitReached}
          >
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                style={{
                  minHeight: 60,
                  border: snapshot.isDraggingOver
                    ? "2px solid #42B4AF"
                    : isLimitReached
                    ? "1px dashed #e57373"
                    : "1px dashed #b2ebf2",
                  padding: 8,
                  borderRadius: 4,
                  background: snapshot.isDraggingOver
                    ? "#e0f7fa33"
                    : isLimitReached
                    ? "#fff5f5"
                    : undefined,
                  display: "flex",
                  flexWrap: "wrap"
                }}
              >
                {ranked.length === 0 && (
                  <span style={{ color: "#bdbdbd" }}>Drag options here to rank</span>
                )}
                {ranked.map((item, index) => (
                  <Draggable key={item.key} draggableId={item.key} index={index}>
                    {(provided2, snapshot2) => (
                      <Item item={item} provided={provided2} snapshot={snapshot2} />
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
                color: isLimitReached ? "#d32f2f" : "#666"
              }}
            >
              Selected {Math.min(ranked.length, maxSelected)} of {maxSelected}
            </div>
          )}
        </div>
        <div>
          <strong>Available options:</strong>
          <Droppable droppableId="available" direction="horizontal">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                style={{
                  minHeight: 60,
                  border: snapshot.isDraggingOver ? "2px solid #42B4AF" : "1px dashed #b2ebf2",
                  padding: 8,
                  borderRadius: 4,
                  background: snapshot.isDraggingOver ? "#e0f7fa33" : undefined,
                  display: "flex",
                  flexWrap: "wrap"
                }}
              >
                {available.map((item, index) => (
                  <Draggable key={item.key} draggableId={item.key} index={index}>
                    {(provided2, snapshot2) => (
                      <Item item={item} provided={provided2} snapshot={snapshot2} />
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
