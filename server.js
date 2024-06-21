const express = require('express');

const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 5000;
const db = require('./db');
const { Pool } = require('pg');
const { Client } = require('ssh2');
const ftp = require('basic-ftp');

app.use(express.json());
app.use(cors());
app.use(bodyParser.json());
const connection = db.connection;


const pgPool = new Pool({
    user: 'freeswitchuser',
    host: '10.16.7.11',
    database: 'dashboardsandreports',
    password: 'Zeniusit11',
    port: 5432,
});



app.get('/', (req, res) => {
    res.send("Hello Node.js application");
});

app.post('/Menunode', async (req, res) => {
    console.log("Request body ::", req.body);
    const { id, Menuname, TexttoSay, Channel, menuoptions } = req.body.RequestBodyforMenu;

    console.log("ID ::", id, "Menuname ::", Menuname, "TexttoSay ::", TexttoSay, "Channel ::", Channel, "Menu options ::", menuoptions);


    try {
        const results = await pgPool.query('SELECT * FROM MenuNode WHERE id = $1', [id]);
        console.log("Results ::", results.rows);

        if (results.rows.length > 0) {
            const updateQuery = 'UPDATE MenuNode SET Menuname = $1, TexttoSay = $2, Channel = $3, menuoption = $4 WHERE id = $5';
            await pgPool.query(updateQuery, [Menuname, TexttoSay, Channel, menuoptions, id]);
            console.log("Menu node updated successfully");
            return res.status(200).json({ message: 'Menu node updated successfully' });
        } else {
            const insertQuery = 'INSERT INTO MenuNode (id, Menuname, TexttoSay, Channel, menuoption) VALUES ($1, $2, $3, $4, $5)';
            console.log("Inside insert", "ID ::", id, "Menuname ::", Menuname, "TexttoSay ::", TexttoSay, "Channel ::", Channel, "Menu options ::", menuoptions);
            await pgPool.query(insertQuery, [id, Menuname, TexttoSay, Channel, menuoptions]);
            console.log("Menu node saved successfully");
            return res.status(200).json({ message: 'Menu node saved successfully' });
        }
    } catch (err) {
        console.error('Error handling menu node:', err);
        return res.status(500).json({ error: 'Failed to handle menu node' });
    }
});


app.post('/save-flow', async (req, res) => {
    const { flowName, lastData } = req.body;
    console.log("Request body ::", req.body);

    const generatedJSCode = generateJSCode(lastData);
    console.log("Generated JS Code :: ", generatedJSCode);



    try {
        if (flowName === "") {
            console.log("The flow name is empty")
            res.status(500).json({ error: 'Failed to save JavaScript code' });
        } else {
            const client = await pgPool.connect();
            const query = 'INSERT INTO Zconnectflow (flowName, jsCode) VALUES ($1, $2) RETURNING id';
            const values = [flowName, Buffer.from(generatedJSCode, 'utf-8')];
            console.log("Values", values);

            const result = await client.query(query, values);
            client.release();
            console.log("Result ::", result);

            if (result.rows.length > 0) {
                const newId = result.rows[0].id;
                res.status(200).json({ message: 'JavaScript code saved successfully', id: newId, content: generatedJSCode });
            } else {
                res.status(500).json({ error: 'Failed to save JavaScript code' });
            }
        }

    } catch (error) {
        console.error('Error saving JavaScript code:', error);
        res.status(500).json({ error: 'Failed to save JavaScript code' });
    }
});

app.post('/check-flow-name', async (req, res) => {
    const { flowName } = req.body;
    console.log("Checking flow name:", flowName);

    try {
        const client = await pgPool.connect();
        const query = 'SELECT 1 FROM Zconnectflow WHERE flowName = $1';
        const values = [flowName];
        const result = await client.query(query, values);
        client.release();

        if (result.rows.length > 0) {
            res.status(200).json({ exists: true });
        } else {
            res.status(200).json({ exists: false });
        }
    } catch (error) {
        console.error('Error checking flow name:', error);
        res.status(500).json({ error: 'Failed to check flow name' });
    }
});


app.post('/deploy', async (req, res) => {
    const { flowName } = req.body;
    console.log("Request body :: ", req.body)
    console.log('Deploying flow with name:', flowName);

    try {
        if (flowName === "") {
            console.log("The flow name is empty ")
            res.status(500).json({ message: 'Failed to deploy flow' });
        } else {
            const result = await pgPool.query('SELECT jscode FROM Zconnectflow WHERE flowname = $1', [flowName]);
            if (result.rows.length === 0) {
                return res.status(404).json({ message: 'Flow not found' });
            }

            console.log('Retrieved flow from the database');

            const jsCodeBuffer = result.rows[0].jscode;

            const conn = new Client();
            conn.on('ready', () => {
                console.log('Client :: ready');
                conn.sftp((err, sftp) => {
                    if (err) throw err;

                    const remotePath = `/etc/zconnectivr/scripts/${flowName}.js`;
                    console.log("Remote path ::", remotePath);
                    sftp.writeFile(remotePath, jsCodeBuffer, (err) => {
                        if (err) {
                            console.error('SFTP error:', err);
                            res.status(500).json({ message: 'Failed to upload file via SFTP' });
                        } else {
                            console.log('File uploaded successfully');


                            const xmlPath = '/etc/zconnectivr/dialplan/default.xml';
                            sftp.readFile(xmlPath, 'utf8', (err, data) => {
                                console.log("Data in 138 line ::", data)
                                let updatedXml;
                                if (err && err.code === 'ENOENT') {

                                    console.log('Dialplan XML does not exist. Creating new file.');
                                    updatedXml = `
    <include>
        <extension name="${flowName}">
        </extension>
    </include>`;
                                } else if (err) {
                                    console.error('Error reading XML file:', err);
                                    return res.status(500).json({ message: 'Failed to read dialplan XML' });
                                } else {
                                    const newExtension = `\n<extension name="${flowName}">\n</extension>\n`;
                                    if (data.includes('</include>')) {
                                        updatedXml = data.replace('\n</include>', `${newExtension}</include>\n`);
                                    } else {

                                        updatedXml = data + `<include>\n${newExtension}</include>\n`;
                                    }
                                }

                                sftp.writeFile(xmlPath, updatedXml, 'utf8', (err) => {
                                    if (err) {
                                        console.error('Error writing XML file:', err);
                                        res.status(500).json({ message: 'Failed to update dialplan XML' });
                                    } else {
                                        console.log('Dialplan XML updated successfully');
                                        res.status(200).json({ message: 'Flow deployed and dialplan XML updated successfully' });
                                    }
                                    conn.end();
                                });
                            });
                        }
                    });
                });
            }).connect({
                host: '10.16.7.11',
                port: 22,
                username: 'cust',
                password: 'Zeniusit@123'
            });

        }

    } catch (error) {
        console.error('Error deploying flow:', error);
        res.status(500).json({ message: 'Failed to deploy flow' });
    }
});

const retrieveCode = async (flowName) => {

    try {
        const query = 'SELECT jsCode FROM Zconnectflow WHERE flowName = $1';
        const values = [flowName];

        const res = await pgPool.query(query, values);
        if (res.rows.length > 0) {
            const jsCode = res.rows[0].jscode.toString('utf-8');
            console.log('JavaScript Code which retrived from PostgreSQL', jsCode);
            return jsCode;
        } else {
            console.log('No code found for the given flow name');
            return null;
        }
    } catch (err) {
        console.error('Error retrieving code:', err);
        throw err;
    }
};

retrieveCode('zenius demo');



function generateJSCode(ivrNodes) {
    var invalidStatus;
    var prevNode;
    var jsCode = `var languageCode = "en/us/callie";
    var soundDir = "/usr/local/freeswitch/sounds/";
 
    function playFile(fileName, callBack, callBackArgs)
    {
      session.streamFile(soundDir + languageCode + "/" + fileName, callBack, callBackArgs);
    }
 
    session.answer();
 
    session.execute("set", "tts_engine=flite");
    session.execute("set", "tts_voice=slt");
`;

    function findNodeByLabel(label) {
        return ivrNodes.find(node => node.sourceLabel === label);
    }

    function processNode(node) {
        console.log("node", node);
        if (!node || node === 'undefined') {
            invalidStatus = {
                status: 500,
                prevNode: prevNode
            }
        } else {
            var nodeType = node.nodeType;
            if (nodeType === "Audio") {
                prevNode = node.sourceLabel;
                var audioFile = node.popupDetails?.initialAudio;
                var TexttoSay = node.popupDetails?.TexttoSay;
                jsCode += audioFile ? `playFile("${audioFile}");\n` : `session.execute("speak", "${TexttoSay}");\n`;
                var targetLabel = node.target;
                var targetNode = findNodeByLabel(targetLabel);
                processNode(targetNode);
            } else if (nodeType === "Menu") {
                prevNode = node.sourceLabel;
                var initialAudio = node.popupDetails?.initialAudio;
                var TexttoSay = node.popupDetails?.TexttoSay;
                jsCode += initialAudio ? `playFile("${initialAudio}");\n` : `session.execute("speak", "${TexttoSay}");\n`;
                jsCode += `var digit = session.getDigits(1, "", 3000);\n switch(digit) {\n`;
                var menuOptions = node.popupDetails.menuoptions;
                // console.log("menuOptions : ", Object.keys(menuOptions).length);

                for (let i = 0; i < menuOptions; i++) {
                    jsCode += `    case "${i + 1}":\n`;
                    var targetLabel = Object.values(node.optionsTarget)[i];
                    console.log("targetLabel : ", targetLabel);
                    var targetNode = findNodeByLabel(targetLabel);
                    processNode(targetNode);
                    jsCode += `break;\n`;
                }

                jsCode += `        default:\nplayFile("Invalid.wav");\n}\n`
            } else if (nodeType === "Hangup") {
                jsCode += `session.hangup();\n`;
            }
        }

    }

    var startNode = ivrNodes.find(node => node.nodeType === "Start");
    if (startNode) {
        var targetNode = findNodeByLabel(startNode.target);
        if (targetNode) {
            processNode(targetNode);
        }
    } else {
        invalidStatus = {
            status: 500,
            prevNode: prevNode !== undefined ? prevNode : 'Start'
        }
    }

    return jsCode;
}



app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
