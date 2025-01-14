// Copyright (c) .NET Foundation and contributors. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';
import * as contracts from './common/interfaces/contracts';
import * as utilities from './common/interfaces/utilities';
import * as vscodeLike from './common/interfaces/vscode-like';
import { ClientMapper } from './common/clientMapper';
import { InteractiveClient } from './common/interactiveClient';
import { defaultNotebookCellLanguage, getNotebookSpecificLanguage, getSimpleLanguage, languageToCellKind } from './common/interactiveNotebook';
import { OutputChannelAdapter } from './common/vscode/OutputChannelAdapter';
import { getEol, vsCodeCellOutputToContractCellOutput } from './common/vscode/vscodeUtilities';
import { Eol } from './common/interfaces';
import { createUri } from './common/utilities';

abstract class DotNetNotebookSerializer implements vscode.NotebookSerializer {

    private serializerId = '*DOTNET-INTERACTIVE-NOTEBOOK-SERIALIZATION*';
    private eol: Eol;

    constructor(
        private readonly clientMapper: ClientMapper,
        private readonly outputChannel: OutputChannelAdapter,
        private readonly extension: string,
    ) {
        this.eol = getEol();
    }

    async deserializeNotebook(content: Uint8Array, token: vscode.CancellationToken): Promise<vscode.NotebookData> {
        const client = await this.getClient();
        let notebookCells: contracts.NotebookCell[] = [];
        try {
            const notebook = await client.parseNotebook(this.getNotebookName(), content);
            notebookCells = notebook.cells;
        } catch (e) {
            this.outputChannel.appendLine(`Error parsing file:\n${e}`);
        }

        if (notebookCells.length === 0) {
            // ensure at least one cell
            notebookCells.push({
                language: defaultNotebookCellLanguage,
                contents: '',
                outputs: [],
            });
        }

        const notebookData: vscode.NotebookData = {
            metadata: new vscode.NotebookDocumentMetadata().with({ cellHasExecutionOrder: false }),
            cells: notebookCells.map(toVsCodeNotebookCellData)
        };
        return notebookData;
    }

    async serializeNotebook(data: vscode.NotebookData, token: vscode.CancellationToken): Promise<Uint8Array> {
        const client = await this.getClient();
        const notebook = {
            cells: data.cells.map(toNotebookCell)
        };
        const content = await client.serializeNotebook(this.getNotebookName(), notebook, this.eol);
        return content;
    }

    private getClient(): Promise<InteractiveClient> {
        return this.clientMapper.getOrAddClient(createUri(this.serializerId));
    }

    private getNotebookName(): string {
        return `dotnet-interactive-notebook${this.extension}`;
    }
}

function toNotebookCell(cell: vscode.NotebookCellData): contracts.NotebookCell {
    const outputs = cell.outputs || [];
    return {
        language: getSimpleLanguage(cell.languageId),
        contents: cell.value,
        outputs: outputs.map(vsCodeCellOutputToContractCellOutput)
    };
}

export class DotNetDibNotebookSerializer extends DotNetNotebookSerializer {
    constructor(clientMapper: ClientMapper, outputChannel: OutputChannelAdapter) {
        super(clientMapper, outputChannel, '.dib');
    }

    static registerNotebookSerializer(context: vscode.ExtensionContext, notebookType: string, clientMapper: ClientMapper, outputChannel: OutputChannelAdapter) {
        const serializer = new DotNetDibNotebookSerializer(clientMapper, outputChannel);
        const notebookSerializer = vscode.notebook.registerNotebookSerializer(notebookType, serializer);
        context.subscriptions.push(notebookSerializer);
    }
}

export class DotNetLegacyNotebookSerializer extends DotNetNotebookSerializer {
    constructor(clientMapper: ClientMapper, outputChannel: OutputChannelAdapter) {
        super(clientMapper, outputChannel, '.dib');
    }

    static registerNotebookSerializer(context: vscode.ExtensionContext, notebookType: string, clientMapper: ClientMapper, outputChannel: OutputChannelAdapter) {
        const serializer = new DotNetLegacyNotebookSerializer(clientMapper, outputChannel);
        const notebookSerializer = vscode.notebook.registerNotebookSerializer(notebookType, serializer);
        context.subscriptions.push(notebookSerializer);
    }
}

export class DotNetJupyterNotebookSerializer extends DotNetNotebookSerializer {
    constructor(clientMapper: ClientMapper, outputChannel: OutputChannelAdapter) {
        super(clientMapper, outputChannel, '.ipynb');
    }
}

function toVsCodeNotebookCellData(cell: contracts.NotebookCell): vscode.NotebookCellData {
    return new vscode.NotebookCellData(
        <number>languageToCellKind(cell.language),
        cell.contents,
        getNotebookSpecificLanguage(cell.language),
        cell.outputs.map(contractCellOutputToVsCodeCellOutput),
    );
}

function contractCellOutputToVsCodeCellOutput(output: contracts.NotebookCellOutput): vscode.NotebookCellOutput {
    const outputItems: Array<vscode.NotebookCellOutputItem> = [];
    if (utilities.isDisplayOutput(output)) {
        for (const mimeKey in output.data) {
            outputItems.push(generateVsCodeNotebookCellOutputItem(output.data[mimeKey], mimeKey));
        }
    } else if (utilities.isErrorOutput(output)) {
        outputItems.push(generateVsCodeNotebookCellOutputItem(output.errorValue, vscodeLike.ErrorOutputMimeType));
    } else if (utilities.isTextOutput(output)) {
        outputItems.push(generateVsCodeNotebookCellOutputItem(output.text, 'text/plain'));
    }

    return new vscode.NotebookCellOutput(outputItems);
}

function generateVsCodeNotebookCellOutputItem(value: Uint8Array | string, mime: string): vscode.NotebookCellOutputItem {
    const displayValue = utilities.reshapeOutputValueForVsCode(value, mime);
    return new vscode.NotebookCellOutputItem(displayValue, mime);
}
