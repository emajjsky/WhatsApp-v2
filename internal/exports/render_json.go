package exports

import "encoding/json"

func RenderJSON(document ExportDocument) ([]byte, error) {
	return json.MarshalIndent(document, "", "  ")
}
