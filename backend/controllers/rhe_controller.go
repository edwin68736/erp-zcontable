package controllers

import (
	"strings"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

// RheListAPI GET /tools/rh/:companyId/comprobantes?tipo=C|V&cod_cpe=02|01&desde=AAAA-MM-DD&hasta=AAAA-MM-DD&estados=01,03
// Consulta la plataforma de confirmación del RHE y de la FE (api-cpe) con las credenciales de API de la empresa.
func (ctrl *SireController) RheListAPI(c fiber.Ctx) error {
	sess, id, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	q := services.RheQuery{
		Tipo:   c.Query("tipo", services.RheTipoCompras),
		CodCpe: c.Query("cod_cpe", "02"),
		Desde:  c.Query("desde"),
		Hasta:  c.Query("hasta"),
	}
	if e := strings.TrimSpace(c.Query("estados")); e != "" {
		q.Estados = strings.Split(e, ",")
	}
	res, lerr := sess.RheList(q)
	if uid, uerr := getUserID(c); uerr == nil {
		ctrl.svc.LogAccessTarget("rhe", id, uid, lerr)
	}
	if lerr != nil {
		return ctrl.fail(c, lerr)
	}
	return c.JSON(fiber.Map{"data": res, "estados": services.RheEstados, "motivos": services.RheMotivos})
}
