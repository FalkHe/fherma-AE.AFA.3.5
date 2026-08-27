"""The advisor agent: the tool-calling loop and the tools it may call.

`tools/` holds the tool convention and one module per tool (step 3.11 onwards);
the loop itself arrives in step 3.13 and is the only caller of
`tools.build_advisor_tools`.
"""
