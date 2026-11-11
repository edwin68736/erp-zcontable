package controllers

import (
	"strconv"
	"strings"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

// SireCpeController descarga de comprobantes electrónicos (PDF, XML y CDR) desde SUNAT (ver services/sire_cpe.go).
type SireCpeController struct {
	svc    *services.SireCpeService
	access *services.AccessService
}

func NewSireCpeController() *SireCpeController {
	return &SireCpeController{svc: services.NewSireCpeService(), access: services.NewAccessService()}
}

func (ctrl *SireCpeController) fail(c fiber.Ctx, err error) error {
	var se *services.SireError
	if errorsAs(err, &se) {
		status := fiber.StatusUnprocessableEntity
		switch se.Code {
		case services.SireErrOutOfScope:
			status = fiber.StatusForbidden
		case services.SireErrUnavailable:
			status = fiber.StatusBadGateway
		case services.SireErrInvalidParams:
			status = fiber.StatusBadRequest
		}
		return c.Status(status).JSON(fiber.Map{"error": se.Message, "code": se.Code, "detail": se.Detail})
	}
	return sunatErrorResponse(c, err, "No se pudo completar la descarga de comprobantes")
}

// scoped valida el alcance del usuario sobre la empresa; si falla ya respondió el error.
func (ctrl *SireCpeController) scoped(c fiber.Ctx) (companyID uint, allowed []uint, ruc string, resp error) {
	if !hasStudioScope(c) {
		uid, uerr := getUserID(c)
		if uerr != nil {
			return 0, nil, "", c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		var err error
		if allowed, err = ctrl.access.GetAllowedCompanyIDs(uid); err != nil {
			return 0, nil, "", c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "No tiene acceso"})
		}
	}
	id, perr := strconv.ParseUint(c.Params("companyId"), 10, 64)
	if perr != nil || id == 0 {
		return 0, nil, "", c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de empresa inválido"})
	}
	ruc, serr := ctrl.svc.InScope(uint(id), allowed)
	if serr != nil {
		return 0, nil, "", ctrl.fail(c, serr)
	}
	return uint(id), allowed, ruc, nil
}

// ListAPI GET /tools/sire/:companyId/cpe?libro=&period=
func (ctrl *SireCpeController) ListAPI(c fiber.Ctx) error {
	id, _, _, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	rows, err := ctrl.svc.List(id, c.Query("libro"), c.Query("period"))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo leer los comprobantes."})
	}
	return c.JSON(fiber.Map{"data": rows})
}

// PropuestaAPI GET /tools/sire/:companyId/cpe/propuesta?download_id= — los comprobantes de una propuesta SIRE lista,
// con lo que ya se descargó de cada uno, para elegir cuáles bajar.
func (ctrl *SireCpeController) PropuestaAPI(c fiber.Ctx) error {
	id, _, ruc, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	did, err := strconv.ParseUint(c.Query("download_id"), 10, 64)
	if err != nil || did == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Indique la consulta del SIRE."})
	}
	lines, skipped, perr := ctrl.svc.PropuestaLines(id, uint(did), ruc)
	if perr != nil {
		return ctrl.fail(c, perr)
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"lines": lines, "skipped": skipped}})
}

// StartAPI POST /tools/sire/:companyId/cpe — {"download_id":12} (todos los comprobantes de una propuesta SIRE lista)
// o {"items":[{"ruc":"…","tipo":"01","serie":"F001","numero":"123"}]}. Se baja en segundo plano.
func (ctrl *SireCpeController) StartAPI(c fiber.Ctx) error {
	id, allowed, ruc, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	var body struct {
		DownloadID uint     `json:"download_id"`
		Keys       []string `json:"keys"`  // comprobantes elegidos de la propuesta («ruc|tipo|serie|número»); vacío = todos
		Kinds      []string `json:"kinds"` // pdf, xml, cdr; vacío = los tres
		Items      []struct {
			Ruc    string `json:"ruc"`
			Tipo   string `json:"tipo"`
			Serie  string `json:"serie"`
			Numero string `json:"numero"`
		} `json:"items"`
	}
	if berr := c.Bind().Body(&body); berr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	var refs []services.CpeRef
	skipped := 0
	if body.DownloadID > 0 {
		var err error
		if refs, skipped, err = ctrl.svc.RefsFromDownload(id, body.DownloadID, ruc, body.Keys); err != nil {
			return ctrl.fail(c, err)
		}
	} else {
		for _, it := range body.Items {
			refs = append(refs, services.CpeRef{Ruc: it.Ruc, Tipo: it.Tipo, Serie: it.Serie, Numero: it.Numero})
		}
	}
	uid, _ := getUserID(c)
	res, err := ctrl.svc.Start(id, allowed, uid, refs, body.Kinds)
	if err != nil {
		return ctrl.fail(c, err)
	}
	res.Skipped = skipped
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"data": res})
}

func cpeID(c fiber.Ctx) (uint, bool) {
	n, err := strconv.ParseUint(c.Params("cpeId"), 10, 64)
	return uint(n), err == nil && n > 0
}

// FileAPI GET /tools/sire/:companyId/cpe/:cpeId/file?kind=pdf|xml|cdr
func (ctrl *SireCpeController) FileAPI(c fiber.Ctx) error {
	id, _, _, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	cid, ok := cpeID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de comprobante inválido"})
	}
	data, name, ctype, err := ctrl.svc.File(id, cid, c.Query("kind"))
	if err != nil {
		return ctrl.fail(c, err)
	}
	return sendSireFile(c, name, ctype, data)
}

// ZipAPI GET /tools/sire/:companyId/cpe/zip?ids=1,2,3 | ?libro=&period= — un ZIP con los archivos de esos comprobantes.
func (ctrl *SireCpeController) ZipAPI(c fiber.Ctx) error {
	id, _, ruc, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	var ids []uint
	for _, p := range strings.Split(c.Query("ids"), ",") {
		if n, err := strconv.ParseUint(strings.TrimSpace(p), 10, 64); err == nil && n > 0 {
			ids = append(ids, uint(n))
		}
	}
	var kinds []string
	for _, k := range strings.Split(c.Query("kinds"), ",") {
		if k = strings.TrimSpace(k); k != "" {
			kinds = append(kinds, k)
		}
	}
	data, n, err := ctrl.svc.Zip(id, ids, c.Query("libro"), c.Query("period"), kinds)
	if err != nil {
		return ctrl.fail(c, err)
	}
	name := ruc + "-comprobantes.zip"
	if p := strings.TrimSpace(c.Query("period")); p != "" {
		name = ruc + "-" + p + "-comprobantes.zip"
	}
	c.Set("X-Cpe-Count", strconv.Itoa(n))
	return sendSireFile(c, name, "application/zip", data)
}

// DeleteAPI DELETE /tools/sire/:companyId/cpe/:cpeId
func (ctrl *SireCpeController) DeleteAPI(c fiber.Ctx) error {
	id, _, _, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	cid, ok := cpeID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de comprobante inválido"})
	}
	if err := ctrl.svc.Delete(id, cid); err != nil {
		return ctrl.fail(c, err)
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}
