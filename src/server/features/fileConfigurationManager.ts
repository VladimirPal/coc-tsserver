/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { workspace, WorkspaceConfiguration, disposeAll } from 'coc.nvim'
import { CancellationToken, Disposable } from 'vscode-languageserver-protocol'
import { TextDocument } from 'coc.nvim'
import Proto from '../protocol'
import { ITypeScriptServiceClient } from '../typescriptService'
import API from '../utils/api'

function objAreEqual<T>(a: T, b: T): boolean {
  let keys = Object.keys(a)
  for (let i = 0; i < keys.length; i++) { // tslint:disable-line
    let key = keys[i]
    if ((a as any)[key] !== (b as any)[key]) {
      return false
    }
  }
  return true
}

interface FormatOptions {
  tabSize: number
  insertSpaces: boolean
}

interface FileConfiguration {
  formatOptions: Proto.FormatCodeSettings
  preferences: Proto.UserPreferences
}

export interface SuggestOptions {
  readonly enabled: boolean
  readonly names: boolean
  readonly paths: boolean
  readonly completeFunctionCalls: boolean
  readonly autoImports: boolean
  readonly includeAutomaticOptionalChainCompletions: boolean
  readonly importStatementSuggestions: boolean
  readonly includeCompletionsForImportStatements: boolean
  readonly includeCompletionsWithSnippetText: boolean
  readonly includeCompletionsWithClassMemberSnippets: boolean
  readonly generateReturnInDocTemplate: boolean
  readonly includeCompletionsWithObjectLiteralMethodSnippets: boolean
}

export default class FileConfigurationManager {
  private cachedMap: Map<string, FileConfiguration> = new Map()
  private disposables: Disposable[] = []

  public constructor(private readonly client: ITypeScriptServiceClient) {
    workspace.onDidCloseTextDocument(textDocument => {
      // When a document gets closed delete the cached formatting options.
      // This is necessary since the tsserver now closed a project when its
      // last file in it closes which drops the stored formatting options
      // as well.
      this.cachedMap.delete(textDocument.uri)
    }, undefined, this.disposables)

  }

  public async ensureConfigurationOptions(document: TextDocument, insertSpaces: boolean, tabSize: number, token: CancellationToken): Promise<void> {
    const file = this.client.toPath(document.uri)
    let options: FormatOptions = {
      tabSize,
      insertSpaces
    }
    let cachedOption = this.cachedMap.get(document.uri)
    const currentOptions = this.getFileOptions(options, document)
    if (cachedOption
      && objAreEqual(cachedOption.formatOptions, currentOptions.formatOptions)
      && objAreEqual(cachedOption.preferences, currentOptions.preferences)) return
    this.cachedMap.set(document.uri, currentOptions)
    const args: Proto.ConfigureRequestArguments = {
      file,
      ...currentOptions
    }
    await this.client.execute('configure', args, CancellationToken.None)
    try {
      const response = await this.client.execute('configure', args, token)
      if (response.type !== 'response') {
        this.cachedMap.delete(document.uri)
      }
    } catch (_e) {
      this.cachedMap.delete(document.uri)
    }
  }

  public async ensureConfigurationForDocument(document: TextDocument, token: CancellationToken): Promise<void> {
    let opts: { insertSpaces: boolean, tabSize: number }
    let cached = this.cachedMap.get(document.uri)
    if (cached) {
      opts = { insertSpaces: cached.formatOptions.convertTabsToSpaces, tabSize: cached.formatOptions.tabSize }
    } else {
      opts = await workspace.getFormatOptions(document.uri)
    }
    return this.ensureConfigurationOptions(document, opts.insertSpaces, opts.tabSize, token)
  }

  public reset(): void {
    this.cachedMap.clear()
  }

  public getLanguageConfiguration(languageId: string): WorkspaceConfiguration {
    return workspace.getConfiguration(languageId)
  }

  public isTypeScriptDocument(languageId: string): boolean {
    return languageId.startsWith('typescript')
  }

  public formatEnabled(document: TextDocument): boolean {
    let { languageId, uri } = document
    let language = languageId.startsWith('typescript') ? 'typescript' : 'javascript'
    const config = workspace.getConfiguration(`${language}.format`, uri)
    return config.get<boolean>('enabled')
  }

  public enableJavascript(): boolean {
    const config = workspace.getConfiguration('tsserver')
    return !!config.get<boolean>('enableJavascript')
  }

  private getFileOptions(options: FormatOptions, document: TextDocument): FileConfiguration {
    const lang = this.isTypeScriptDocument(document.languageId) ? 'typescript' : 'javascript'
    return {
      formatOptions: this.getFormatOptions(options, lang, document.uri),
      preferences: this.getPreferences(lang, document.uri)
    }
  }

  private getFormatOptions(options: FormatOptions, language: string, uri: string): Proto.FormatCodeSettings {
    const config = workspace.getConfiguration(`${language}.format`, uri)

    return {
      tabSize: options.tabSize,
      indentSize: options.tabSize,
      convertTabsToSpaces: options.insertSpaces,
      // We can use \n here since the editor normalizes later on to its line endings.
      newLineCharacter: '\n',
      insertSpaceAfterCommaDelimiter: config.get<boolean>('insertSpaceAfterCommaDelimiter'),
      insertSpaceAfterConstructor: config.get<boolean>('insertSpaceAfterConstructor'),
      insertSpaceAfterSemicolonInForStatements: config.get<boolean>('insertSpaceAfterSemicolonInForStatements'),
      insertSpaceBeforeAndAfterBinaryOperators: config.get<boolean>('insertSpaceBeforeAndAfterBinaryOperators'),
      insertSpaceAfterKeywordsInControlFlowStatements: config.get<boolean>('insertSpaceAfterKeywordsInControlFlowStatements'),
      insertSpaceAfterFunctionKeywordForAnonymousFunctions: config.get<boolean>('insertSpaceAfterFunctionKeywordForAnonymousFunctions'),
      insertSpaceBeforeFunctionParenthesis: config.get<boolean>('insertSpaceBeforeFunctionParenthesis'),
      insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis'),
      insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets'),
      insertSpaceAfterOpeningAndBeforeClosingEmptyBraces: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingEmptyBraces'),
      insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces'),
      insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces'),
      insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces'),
      insertSpaceAfterTypeAssertion: config.get<boolean>('insertSpaceAfterTypeAssertion'),
      placeOpenBraceOnNewLineForFunctions: config.get<boolean>('placeOpenBraceOnNewLineForFunctions'),
      placeOpenBraceOnNewLineForControlBlocks: config.get<boolean>('placeOpenBraceOnNewLineForControlBlocks'),
      semicolons: config.get<Proto.SemicolonPreference>('semicolons', undefined)
    }
  }

  public getCompleteOptions(languageId: string): SuggestOptions {
    const lang = this.isTypeScriptDocument(languageId) ? 'typescript' : 'javascript'
    const config = workspace.getConfiguration(`${lang}.suggest`)
    return {
      enabled: config.get<boolean>('enabled', true),
      names: config.get<boolean>('names', true),
      paths: config.get<boolean>('paths', true),
      completeFunctionCalls: config.get<boolean>('completeFunctionCalls', true),
      autoImports: config.get<boolean>('autoImports', true),
      includeCompletionsWithObjectLiteralMethodSnippets: config.get<boolean>('suggest.objectLiteralMethodSnippets.enabled', true),
      generateReturnInDocTemplate: config.get<boolean>('jsdoc.generateReturns', true),
      importStatementSuggestions: config.get<boolean>('importStatements', true),
      includeCompletionsForImportStatements: config.get<boolean>('includeCompletionsForImportStatements', true),
      includeCompletionsWithSnippetText: config.get<boolean>('includeCompletionsWithSnippetText', true),
      includeCompletionsWithClassMemberSnippets: config.get<boolean>('classMemberSnippets.enabled', true),
      includeAutomaticOptionalChainCompletions: config.get<boolean>('includeAutomaticOptionalChainCompletions', true)
    }
  }

  public getPreferences(language: string, uri: string): Proto.UserPreferences {
    if (this.client.apiVersion.lt(API.v290)) {
      return {}
    }
    const config = workspace.getConfiguration(language, uri)
    const preferencesConfig = workspace.getConfiguration(`${language}.preferences`, uri)
    const suggestConfig = this.getCompleteOptions(language)
    // getImportModuleSpecifierEndingPreference available on ts 2.9.0
    const preferences: Proto.UserPreferences = {
      quotePreference: this.getQuoteStyle(preferencesConfig),
      importModuleSpecifierPreference: getImportModuleSpecifier(preferencesConfig) as any,
      importModuleSpecifierEnding: getImportModuleSpecifierEndingPreference(preferencesConfig),
      jsxAttributeCompletionStyle: getJsxAttributeCompletionStyle(preferencesConfig),
      allowTextChangesInNewFiles: uri.startsWith('file:'),
      allowRenameOfImportPath: true,
      // can't support it with coc.nvim by now.
      provideRefactorNotApplicableReason: false,
      providePrefixAndSuffixTextForRename: preferencesConfig.get<boolean>('renameShorthandProperties', true) === false ? false : preferencesConfig.get<boolean>('useAliasesForRenames', true),
      generateReturnInDocTemplate: suggestConfig.generateReturnInDocTemplate,
      includeCompletionsForImportStatements: suggestConfig.includeCompletionsForImportStatements,
      includeCompletionsWithClassMemberSnippets: suggestConfig.includeCompletionsWithClassMemberSnippets,
      includeCompletionsWithSnippetText: suggestConfig.includeCompletionsWithSnippetText,
      // @ts-expect-error until 4.7
      includeCompletionsWithObjectLiteralMethodSnippets: suggestConfig.includeCompletionsWithObjectLiteralMethodSnippets,
      includeAutomaticOptionalChainCompletions: suggestConfig.includeAutomaticOptionalChainCompletions,
      useLabelDetailsInCompletionEntries: true,
      allowIncompleteCompletions: true,
      displayPartsForJSDoc: true,
      ...getInlayHintsPreferences(config),
    }
    return preferences
  }

  private getQuoteStyle(config: WorkspaceConfiguration): 'auto' | 'double' | 'single' {
    let quoteStyle = config.get<'single' | 'double' | 'auto'>('quoteStyle', 'auto')
    if (this.client.apiVersion.gte(API.v333) || quoteStyle != 'auto') return quoteStyle
    return 'single'
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

type ModuleImportType = 'shortest' | 'project-relative' | 'relative' | 'non-relative'

function getImportModuleSpecifier(config: WorkspaceConfiguration): ModuleImportType {
  let val = config.get('importModuleSpecifier')
  switch (val) {
    case 'project-relative':
      return 'project-relative'
    case 'relative':
      return 'relative'
    case 'non-relative':
      return 'non-relative'
    default:
      return undefined
  }
}

function getImportModuleSpecifierEndingPreference(config: WorkspaceConfiguration): any {
  switch (config.get<string>('importModuleSpecifierEnding')) {
    case 'minimal': return 'minimal'
    case 'index': return 'index'
    case 'js': return 'js'
    default: return 'auto'
  }
}

function getJsxAttributeCompletionStyle(config: WorkspaceConfiguration) {
  switch (config.get<string>('jsxAttributeCompletionStyle')) {
    case 'braces': return 'braces'
    case 'none': return 'none'
    default: return 'auto'
  }
}

export class InlayHintSettingNames {
  static readonly parameterNamesSuppressWhenArgumentMatchesName = 'inlayHints.parameterNames.suppressWhenArgumentMatchesName'
  static readonly parameterNamesEnabled = 'inlayHints.parameterTypes.enabled'
  static readonly variableTypesEnabled = 'inlayHints.variableTypes.enabled'
  static readonly propertyDeclarationTypesEnabled = 'inlayHints.propertyDeclarationTypes.enabled'
  static readonly functionLikeReturnTypesEnabled = 'inlayHints.functionLikeReturnTypes.enabled'
  static readonly enumMemberValuesEnabled = 'inlayHints.enumMemberValues.enabled'
}

export function getInlayHintsPreferences(config: WorkspaceConfiguration) {
  return {
    includeInlayParameterNameHints: getInlayParameterNameHintsPreference(config),
    includeInlayParameterNameHintsWhenArgumentMatchesName: !config.get<boolean>(InlayHintSettingNames.parameterNamesSuppressWhenArgumentMatchesName, true),
    includeInlayFunctionParameterTypeHints: config.get<boolean>(InlayHintSettingNames.parameterNamesEnabled, false),
    includeInlayVariableTypeHints: config.get<boolean>(InlayHintSettingNames.variableTypesEnabled, false),
    includeInlayPropertyDeclarationTypeHints: config.get<boolean>(InlayHintSettingNames.propertyDeclarationTypesEnabled, false),
    includeInlayFunctionLikeReturnTypeHints: config.get<boolean>(InlayHintSettingNames.functionLikeReturnTypesEnabled, false),
    includeInlayEnumMemberValueHints: config.get<boolean>(InlayHintSettingNames.enumMemberValuesEnabled, false),
  } as const
}

function getInlayParameterNameHintsPreference(config: WorkspaceConfiguration) {
  switch (config.get<string>('inlayHints.parameterNames.enabled')) {
    case 'none': return 'none'
    case 'literals': return 'literals'
    case 'all': return 'all'
    default: return undefined
  }
}
