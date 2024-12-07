import React, { useState } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import './TextInput.css';

var toolbarOptions = [
  ['bold', 'italic', 'underline', 'strike'],        // toggled buttons
  ['blockquote', 'code-block'],
  ['link', 'image'],
  [{ 'header': 1 }, { 'header': 2 }],               // custom button values
  [{ 'list': 'ordered'}, { 'list': 'bullet' }],
  [{ 'indent': '-1'}, { 'indent': '+1' }],          // outdent/indent

  [{ 'size': ['small', false, 'large', 'huge'] }],  // custom dropdown
  [{ 'header': [1, 2, 3, 4, 5, 6, false] }],

  [{ 'color': [] }, { 'background': [] }],          // dropdown with defaults from theme
  [{ 'font': [] }],
  [{ 'align': [] }],

  ['clean']                                         // remove formatting button
];



const TextInput = () => {
  const [inputValue, setInputValue] = useState('');

  const handleInputChange = (value) => {
    setInputValue(value);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    // Perform submit logic here with the input value
    // For example, you can log the value to the console
    console.log(inputValue);
    setInputValue('');
  };

  return (
    <div className="text-input-container">
      <form onSubmit={handleSubmit}>
        <ReactQuill
          value={inputValue}
          onChange={handleInputChange}
          placeholder="Enter your text here"
          modules={{ toolbar: toolbarOptions }}
        />
        <button type="submit" className="submit-button">Submit</button>
      </form>
    </div>
  );
};

export default TextInput;
