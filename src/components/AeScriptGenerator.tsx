import React, { useState } from 'react';
import { FileCode, Search } from 'lucide-react';

interface Layer {
  name: string;
  isHidden: boolean;
}

export const AeScriptGenerator: React.FC<{ onCancel: () => void }> = ({ onCancel }) => {
  const [layersInput, setLayersInput] = useState('');
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [duration, setDuration] = useState('5');
  const [generatedScript, setGeneratedScript] = useState('');

  const processLayers = () => {
    const lines = layersInput.split('\n').filter(line => line.trim() !== '');
    const newLayers: Layer[] = lines.map(line => ({
      name: line.trim().replace('(hidden)', '').trim(),
      isHidden: line.includes('(hidden)')
    }));

    const nameCounts: Record<string, number> = {};
    const dups: string[] = [];
    const hiddenLayers: string[] = [];

    newLayers.forEach(layer => {
      nameCounts[layer.name] = (nameCounts[layer.name] || 0) + 1;
      if (layer.isHidden) hiddenLayers.push(layer.name);
    });

    Object.entries(nameCounts).forEach(([name, count]) => {
      if (count > 1) dups.push(name);
    });

    setDuplicates(dups);
    setHidden(hiddenLayers);
  };

  const generateScript = () => {
    let script = `// After Effects Script to copy duplicate and hidden layers\n\n`;
    script += `var comp = app.project.activeItem;\n`;
    script += `if (comp instanceof CompItem) {\n`;
    script += `  var durationInput = prompt("أدخل مدة الطبقات بالثواني:", "${duration}");\n`;
    script += `  if (durationInput != null) {\n`;
    script += `    var duration = parseFloat(durationInput);\n`;
    script += `    app.beginUndoGroup("Copy Duplicate and Hidden Layers");\n`;
    
    duplicates.forEach(name => {
      script += `    // Logic to duplicate layer: ${name}\n`;
      script += `    var layers = comp.layers;\n`;
      script += `    for (var i = 1; i <= layers.length; i++) {\n`;
      script += `      if (layers[i].name === "${name}") {\n`;
      script += `        var newLayer = layers[i].duplicate();\n`;
      script += `        newLayer.outPoint = duration;\n`;
      script += `      }\n`;
      script += `    }\n`;
    });

    hidden.forEach(name => {
      script += `    // Logic to duplicate hidden layer: ${name}\n`;
      script += `    var layers = comp.layers;\n`;
      script += `    for (var i = 1; i <= layers.length; i++) {\n`;
      script += `      if (layers[i].name === "${name}" && !layers[i].enabled) {\n`;
      script += `        var newLayer = layers[i].duplicate();\n`;
      script += `        newLayer.outPoint = duration;\n`;
      script += `      }\n`;
      script += `    }\n`;
    });

    script += `    app.endUndoGroup();\n`;
    script += `    alert("تمت العملية بنجاح!");\n`;
    script += `  }\n`;
    script += `} else {\n`;
    script += `  alert("يرجى اختيار Composition أولاً.");\n`;
    script += `}\n`;
    setGeneratedScript(script);
  };

  return (
    <div className="bg-slate-900/80 p-6 rounded-xl border border-slate-700">
      <h2 className="text-2xl font-bold mb-4 text-white">After Effects Script Generator</h2>
      <p className="text-slate-400 mb-4">Paste layer names here (one per line, add '(hidden)' for hidden layers)</p>
      <textarea
        className="w-full h-32 bg-slate-800 text-white p-2 rounded mb-4"
        placeholder="Layer 1&#10;Layer 2&#10;Layer 1 (hidden)"
        value={layersInput}
        onChange={(e) => setLayersInput(e.target.value)}
      />
      <div className="mb-4">
        <label className="text-slate-400 block mb-1">Duration (seconds):</label>
        <input
          type="number"
          className="w-full bg-slate-800 text-white p-2 rounded"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
      </div>
      <button onClick={processLayers} className="bg-blue-600 text-white px-4 py-2 rounded mb-4 mr-2">
        <Search className="inline mr-2" />
        Find Duplicates & Hidden
      </button>
      
      <div className="mb-4 text-slate-300">
        <p>Duplicates: {duplicates.join(', ') || 'None'}</p>
        <p>Hidden: {hidden.join(', ') || 'None'}</p>
      </div>
      
      <button onClick={generateScript} className="bg-green-600 text-white px-4 py-2 rounded mb-4">
        <FileCode className="inline mr-2" />
        Generate Script
      </button>
      
      {generatedScript && (
        <div className="mt-4">
          <h3 className="text-lg font-bold text-white mb-2">Generated ExtendScript (.jsx):</h3>
          <pre className="bg-slate-800 text-green-400 p-4 rounded overflow-x-auto text-sm">
            {generatedScript}
          </pre>
        </div>
      )}
      <button onClick={onCancel} className="bg-slate-600 text-white px-4 py-2 rounded mt-4">Cancel</button>
    </div>
  );
};
