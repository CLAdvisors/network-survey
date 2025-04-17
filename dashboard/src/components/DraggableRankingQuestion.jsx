import React from "react";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";

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
      {item.text}
    </div>
  );
}

export default function DraggableRankingQuestion({ question, value, onChange }) {
  const [ranked, setRanked] = React.useState(value || []);
  const [available, setAvailable] = React.useState(question.options || []);

  React.useEffect(() => {
    const initialRanked = value || [];
    const initialAvailable = (question.options || []).filter(
      (opt) => !initialRanked.some((r) => r.value === opt.value)
    );
    setRanked(initialRanked);
    setAvailable(initialAvailable);
  }, [question.options, value]);

  const handleDragEnd = (result) => {
    const { source, destination } = result;
    if (!destination) return;

    if (source.droppableId === "ranked" && destination.droppableId === "ranked") {
      const newRanked = Array.from(ranked);
      const [moved] = newRanked.splice(source.index, 1);
      newRanked.splice(destination.index, 0, moved);
      setRanked(newRanked);
      onChange(newRanked);
    } else if (source.droppableId === "available" && destination.droppableId === "ranked") {
      const newAvailable = Array.from(available);
      const [moved] = newAvailable.splice(source.index, 1);
      const newRanked = Array.from(ranked);
      newRanked.splice(destination.index, 0, moved);
      setAvailable(newAvailable);
      setRanked(newRanked);
      onChange(newRanked);
    } else if (source.droppableId === "ranked" && destination.droppableId === "available") {
      const newRanked = Array.from(ranked);
      const [moved] = newRanked.splice(source.index, 1);
      const newAvailable = Array.from(available);
      newAvailable.splice(destination.index, 0, moved);
      setRanked(newRanked);
      setAvailable(newAvailable);
      onChange(newRanked);
    }
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ marginBottom: 16 }}>
          <strong>Ranked (drag items here to rank):</strong>
          <Droppable droppableId="ranked" direction="horizontal">
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
                {ranked.length === 0 && (
                  <span style={{ color: "#bdbdbd" }}>Drag options here to rank</span>
                )}
                {ranked.map((item, index) => (
                  <Draggable key={item.value} draggableId={item.value} index={index}>
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
                  <Draggable key={item.value} draggableId={item.value} index={index}>
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
